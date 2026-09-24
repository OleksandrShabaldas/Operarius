package com.operarius.calendar

import android.Manifest
import android.accounts.Account
import android.content.ContentResolver
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.database.ContentObserver
import android.database.Cursor
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.CalendarContract
import android.provider.CalendarContract.Calendars
import android.provider.CalendarContract.Events
import android.provider.CalendarContract.Instances
import androidx.core.content.ContextCompat
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.TimeZone

/** What the app writes into an event (or into one occurrence of a recurring event). */
class EventInput : Record {
  @Field var title: String = ""
  @Field var description: String = ""
  @Field var start: Double = 0.0 // epoch ms (all-day: UTC midnight)
  @Field var end: Double = 0.0 // epoch ms (all-day: UTC midnight after the last day)
  @Field var allDay: Boolean = false
  @Field var timeZone: String = "" // "" = the phone's zone
  @Field var rrule: String? = null // RFC 5545 rule; null = a single event
  @Field var appUri: String? = null // marks the event as the app's own (opens its task)
}

/**
 * The JS bridge (modules/calendar/index.ts) to Android's Calendar Provider:
 * the phone's calendars — a Google account's included, which the phone keeps
 * in sync with Google — read and written directly, with full recurrence
 * rules and single-occurrence edits.
 */
class CalendarModule : Module() {
  private val context: Context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
  private val resolver: ContentResolver get() = context.contentResolver

  private val main = Handler(Looper.getMainLooper())
  private var observer: ContentObserver? = null
  private val fire = Runnable {
    try {
      sendEvent("onChange", mapOf("at" to System.currentTimeMillis().toDouble()))
    } catch (_: Throwable) {
    }
  }

  private fun granted(): Boolean {
    val ctx = context
    return ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED &&
      ContextCompat.checkSelfPermission(ctx, Manifest.permission.WRITE_CALENDAR) == PackageManager.PERMISSION_GRANTED
  }

  override fun definition() = ModuleDefinition {
    Name("OperariusCalendar")
    Events("onChange")

    OnDestroy { unwatch() }

    AsyncFunction("permission") {
      if (granted()) "granted" else "denied"
    }

    AsyncFunction("requestPermission") { promise: Promise ->
      if (granted()) {
        promise.resolve(true)
        return@AsyncFunction
      }
      val perms = appContext.permissions
      if (perms == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      perms.askForPermissions({ result ->
        promise.resolve(
          result[Manifest.permission.READ_CALENDAR]?.status == PermissionsStatus.GRANTED &&
            result[Manifest.permission.WRITE_CALENDAR]?.status == PermissionsStatus.GRANTED
        )
      }, Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR)
    }

    // Every calendar on the phone.
    AsyncFunction("calendars") {
      if (!granted()) return@AsyncFunction emptyList<Map<String, Any?>>()
      val base = arrayOf(
        Calendars._ID,
        Calendars.CALENDAR_DISPLAY_NAME,
        Calendars.ACCOUNT_NAME,
        Calendars.ACCOUNT_TYPE,
        Calendars.CALENDAR_COLOR,
        Calendars.CALENDAR_ACCESS_LEVEL,
        Calendars.VISIBLE,
        Calendars.OWNER_ACCOUNT,
      )
      val out = mutableListOf<Map<String, Any?>>()
      // IS_PRIMARY isn't served by every provider: ask with it, then without.
      val c = try {
        resolver.query(Calendars.CONTENT_URI, base + Calendars.IS_PRIMARY, null, null, null)
      } catch (_: Exception) {
        resolver.query(Calendars.CONTENT_URI, base, null, null, null)
      }
      c?.use { cur ->
        val hasPrimary = cur.columnCount > base.size
        while (cur.moveToNext()) {
          val access = cur.getInt(5)
          val account = cur.getString(2) ?: ""
          val owner = cur.getString(7) ?: ""
          out += mapOf(
            "id" to cur.getLong(0).toString(),
            "name" to (cur.getString(1) ?: "Calendar"),
            "account" to account,
            "accountType" to (cur.getString(3) ?: ""),
            "color" to hex(cur.getInt(4)),
            "writable" to (access >= Calendars.CAL_ACCESS_CONTRIBUTOR),
            "visible" to (cur.getInt(6) == 1),
            "primary" to ((hasPrimary && cur.getInt(8) == 1) || (owner.isNotEmpty() && owner == account)),
          )
        }
      }
      out
    }

    // The occurrences in [from, to) of one calendar's events (recurring ones
    // expanded; moved occurrences are their own events with the original id).
    AsyncFunction("instances") { calendarId: String, from: Double, to: Double ->
      if (!granted()) return@AsyncFunction emptyList<Map<String, Any?>>()
      val uri = Instances.CONTENT_URI.buildUpon().also {
        ContentUris.appendId(it, from.toLong())
        ContentUris.appendId(it, to.toLong())
      }.build()
      val proj = arrayOf(
        Instances.EVENT_ID,
        Instances.BEGIN,
        Instances.END,
        Instances.ALL_DAY,
        Instances.TITLE,
        Instances.DESCRIPTION,
        Instances.RRULE,
        Instances.EVENT_TIMEZONE,
        Instances.ORIGINAL_ID,
        Instances.ORIGINAL_INSTANCE_TIME,
        Instances.STATUS,
        Instances.DISPLAY_COLOR,
        Instances.EVENT_LOCATION,
        Instances.CUSTOM_APP_PACKAGE,
        Instances.CUSTOM_APP_URI,
      )
      val pkg = context.packageName
      val out = mutableListOf<Map<String, Any?>>()
      resolver.query(uri, proj, "${Instances.CALENDAR_ID} = ?", arrayOf(calendarId), "${Instances.BEGIN} ASC")?.use { cur ->
        while (cur.moveToNext()) {
          if (!cur.isNull(10) && cur.getInt(10) == Events.STATUS_CANCELED) continue
          out += mapOf(
            "eventId" to cur.getLong(0).toString(),
            "begin" to cur.getLong(1).toDouble(),
            "end" to cur.getLong(2).toDouble(),
            "allDay" to (cur.getInt(3) == 1),
            "title" to (cur.getString(4) ?: ""),
            "description" to (cur.getString(5) ?: ""),
            "rrule" to cur.getString(6),
            "timeZone" to cur.getString(7),
            "originalId" to cur.opt(8)?.toString(),
            "originalBegin" to cur.optLong(9)?.toDouble(),
            "color" to (if (cur.isNull(11)) null else hex(cur.getInt(11))),
            "location" to (cur.getString(12) ?: ""),
            "appUri" to (if (cur.getString(13) == pkg) cur.getString(14) else null),
          )
        }
      }
      out
    }

    // One event as stored (null when gone, or deleted and waiting for its sync).
    AsyncFunction("event") { id: String ->
      if (!granted()) return@AsyncFunction null
      val n = id.toLongOrNull() ?: return@AsyncFunction null
      readEvents(listOf(n)).firstOrNull()
    }

    // Several events at once (the ones gone are left out).
    AsyncFunction("events") { ids: List<String> ->
      if (!granted()) return@AsyncFunction emptyList<Map<String, Any?>>()
      readEvents(ids.mapNotNull { it.toLongOrNull() })
    }

    // The changed occurrences (exception events) of recurring events.
    AsyncFunction("exceptions") { masterIds: List<String> ->
      if (!granted()) return@AsyncFunction emptyList<Map<String, Any?>>()
      readEvents(masterIds.mapNotNull { it.toLongOrNull() }, Events.ORIGINAL_ID)
    }

    // Create (id null) or update an event; returns its id. An update of an
    // event that has since gone creates it again (with a new id).
    AsyncFunction("upsert") { calendarId: String, id: String?, e: EventInput ->
      if (!granted()) throw Exceptions.MissingPermissions(Manifest.permission.WRITE_CALENDAR)
      val values = eventValues(e).apply { put(Events.CALENDAR_ID, calendarId.toLong()) }
      markApp(values, e.appUri)
      val existing = id?.toLongOrNull()
      if (existing != null && alive(existing)) {
        val n = withAppFallback(values) { resolver.update(ContentUris.withAppendedId(Events.CONTENT_URI, existing), it, null, null) }
        if (n > 0) return@AsyncFunction existing.toString()
      }
      val uri = withAppFallback(values) { resolver.insert(Events.CONTENT_URI, it) } ?: throw IllegalStateException("The calendar didn't take the event")
      ContentUris.parseId(uri).toString()
    }

    AsyncFunction("remove") { id: String ->
      if (!granted()) return@AsyncFunction false
      val n = id.toLongOrNull()?.let { resolver.delete(ContentUris.withAppendedId(Events.CONTENT_URI, it), null, null) } ?: 0
      n > 0
    }

    // Change one occurrence of a recurring event (it becomes an exception
    // event of its own); returns that exception's id.
    AsyncFunction("upsertOccurrence") { masterId: String, originalBegin: Double, exceptionId: String?, e: EventInput ->
      if (!granted()) throw Exceptions.MissingPermissions(Manifest.permission.WRITE_CALENDAR)
      val existing = exceptionId?.toLongOrNull()
      if (existing != null && existing != masterId.toLongOrNull() && alive(existing)) {
        // (an occurrence cancelled in the calendar comes back when rewritten)
        val values = eventValues(e.apply { rrule = null }).apply { put(Events.STATUS, Events.STATUS_CONFIRMED) }
        val n = resolver.update(ContentUris.withAppendedId(Events.CONTENT_URI, existing), values, null, null)
        if (n > 0) return@AsyncFunction existing.toString()
      }
      // A new exception carries a duration (its end is derived from it).
      val start = e.start.toLong()
      val end = maxOf(e.end.toLong(), start + 60_000)
      val values = ContentValues().apply {
        put(Events.TITLE, e.title)
        put(Events.DESCRIPTION, e.description)
        put(Events.ALL_DAY, if (e.allDay) 1 else 0)
        put(Events.EVENT_TIMEZONE, if (e.allDay) "UTC" else e.timeZone.ifEmpty { TimeZone.getDefault().id })
        put(Events.DTSTART, start)
        put(Events.DURATION, duration(start, end, e.allDay))
        put(Events.ORIGINAL_INSTANCE_TIME, originalBegin.toLong())
      }
      val uri = resolver.insert(ContentUris.withAppendedId(Events.CONTENT_EXCEPTION_URI, masterId.toLong()), values)
        ?: throw IllegalStateException("The calendar didn't take the change")
      ContentUris.parseId(uri).toString()
    }

    // Drop one occurrence of a recurring event.
    AsyncFunction("cancelOccurrence") { masterId: String, originalBegin: Double, exceptionId: String? ->
      if (!granted()) return@AsyncFunction false
      val existing = exceptionId?.toLongOrNull()
      if (existing != null && existing != masterId.toLongOrNull() && alive(existing)) {
        val values = ContentValues().apply { put(Events.STATUS, Events.STATUS_CANCELED) }
        if (resolver.update(ContentUris.withAppendedId(Events.CONTENT_URI, existing), values, null, null) > 0) return@AsyncFunction true
      }
      val values = ContentValues().apply {
        put(Events.ORIGINAL_INSTANCE_TIME, originalBegin.toLong())
        put(Events.STATUS, Events.STATUS_CANCELED)
      }
      resolver.insert(ContentUris.withAppendedId(Events.CONTENT_EXCEPTION_URI, masterId.toLong()), values) != null
    }

    // Ask the calendar's account to sync with its server now (Google), so
    // changes land there — and theirs here — without waiting.
    AsyncFunction("refresh") { calendarId: String ->
      if (!granted()) return@AsyncFunction false
      val id = calendarId.toLongOrNull() ?: return@AsyncFunction false
      val acc = resolver.query(ContentUris.withAppendedId(Calendars.CONTENT_URI, id), arrayOf(Calendars.ACCOUNT_NAME, Calendars.ACCOUNT_TYPE), null, null, null)?.use { cur ->
        if (cur.moveToFirst()) Account(cur.getString(0) ?: return@use null, cur.getString(1) ?: return@use null) else null
      } ?: return@AsyncFunction false
      if (acc.type == CalendarContract.ACCOUNT_TYPE_LOCAL) return@AsyncFunction false
      try {
        ContentResolver.requestSync(acc, CalendarContract.AUTHORITY, Bundle().apply {
          putBoolean(ContentResolver.SYNC_EXTRAS_MANUAL, true)
          putBoolean(ContentResolver.SYNC_EXTRAS_EXPEDITED, true)
        })
        true
      } catch (_: Exception) {
        false
      }
    }

    // Tell the app (onChange) whenever the phone's calendars change — an event
    // edited in another app, or new ones synced down from Google.
    AsyncFunction("watch") { on: Boolean ->
      if (!on || !granted()) {
        unwatch()
        return@AsyncFunction false
      }
      if (observer == null) {
        val o = object : ContentObserver(main) {
          override fun onChange(selfChange: Boolean) = onChange(selfChange, null)
          override fun onChange(selfChange: Boolean, uri: Uri?) {
            main.removeCallbacks(fire)
            main.postDelayed(fire, 1500)
          }
        }
        resolver.registerContentObserver(CalendarContract.CONTENT_URI, true, o)
        observer = o
      }
      true
    }
  }

  private fun unwatch() {
    main.removeCallbacks(fire)
    observer?.let {
      try {
        appContext.reactContext?.contentResolver?.unregisterContentObserver(it)
      } catch (_: Exception) {
      }
    }
    observer = null
  }

  // Is the event still there (not deleted and waiting for its sync)? Writing
  // to a deleted one would leave it deleted.
  private fun alive(id: Long): Boolean =
    resolver.query(ContentUris.withAppendedId(Events.CONTENT_URI, id), arrayOf(Events.DELETED), null, null, null)?.use { it.moveToFirst() && it.getInt(0) != 1 } ?: false

  // Events by id (or, with `by` = ORIGINAL_ID, the exceptions of these events).
  private fun readEvents(ids: List<Long>, by: String = Events._ID): List<Map<String, Any?>> {
    if (ids.isEmpty()) return emptyList()
    val proj = arrayOf(
      Events._ID,
      Events.TITLE,
      Events.DESCRIPTION,
      Events.DTSTART,
      Events.DTEND,
      Events.DURATION,
      Events.ALL_DAY,
      Events.RRULE,
      Events.EVENT_TIMEZONE,
      Events.CALENDAR_ID,
      Events.DELETED,
      Events.STATUS,
      Events.DISPLAY_COLOR,
      Events.EVENT_LOCATION,
      Events.CUSTOM_APP_PACKAGE,
      Events.CUSTOM_APP_URI,
      Events.ORIGINAL_ID,
      Events.ORIGINAL_INSTANCE_TIME,
    )
    val pkg = context.packageName
    val out = mutableListOf<Map<String, Any?>>()
    // SQLite caps the parameters of one statement — ask in chunks.
    for (chunk in ids.distinct().chunked(400)) {
      val sel = "$by IN (${chunk.joinToString(",") { "?" }})"
      resolver.query(Events.CONTENT_URI, proj, sel, chunk.map { it.toString() }.toTypedArray(), null)?.use { cur ->
        while (cur.moveToNext()) {
          if (cur.getInt(10) == 1) continue
          if (!cur.isNull(11) && cur.getInt(11) == Events.STATUS_CANCELED) continue
          out += mapOf(
            "id" to cur.getLong(0).toString(),
            "title" to (cur.getString(1) ?: ""),
            "description" to (cur.getString(2) ?: ""),
            "start" to cur.getLong(3).toDouble(),
            "end" to cur.optLong(4)?.toDouble(),
            "duration" to cur.getString(5),
            "allDay" to (cur.getInt(6) == 1),
            "rrule" to cur.getString(7),
            "timeZone" to cur.getString(8),
            "calendarId" to cur.getLong(9).toString(),
            "color" to (if (cur.isNull(12)) null else hex(cur.getInt(12))),
            "location" to (cur.getString(13) ?: ""),
            "appUri" to (if (cur.getString(14) == pkg) cur.getString(15) else null),
            "originalId" to cur.opt(16)?.toString(),
            "originalBegin" to cur.optLong(17)?.toDouble(),
          )
        }
      }
    }
    return out
  }

  private fun eventValues(e: EventInput) = ContentValues().apply {
    val start = e.start.toLong()
    val end = maxOf(e.end.toLong(), start + 60_000)
    put(Events.TITLE, e.title)
    put(Events.DESCRIPTION, e.description)
    put(Events.ALL_DAY, if (e.allDay) 1 else 0)
    // All-day events live in UTC (midnight to midnight), as the provider expects.
    put(Events.EVENT_TIMEZONE, if (e.allDay) "UTC" else e.timeZone.ifEmpty { TimeZone.getDefault().id })
    put(Events.DTSTART, start)
    val rule = e.rrule
    if (rule.isNullOrEmpty()) {
      put(Events.DTEND, end)
      putNull(Events.RRULE)
      putNull(Events.DURATION)
    } else {
      // A recurring event carries a duration instead of an end.
      putNull(Events.DTEND)
      put(Events.RRULE, rule)
      put(Events.DURATION, duration(start, end, e.allDay))
    }
  }

  private fun duration(start: Long, end: Long, allDay: Boolean) =
    if (allDay) "P${maxOf(1L, (end - start + 43_200_000L) / 86_400_000L)}D" else "P${maxOf(60L, (end - start) / 1000L)}S"

  // The app's own events carry its package (and a link to their task), so
  // they're never mistaken for the calendar's own events.
  private fun markApp(values: ContentValues, appUri: String?) {
    if (appUri.isNullOrEmpty()) return
    values.put(Events.CUSTOM_APP_PACKAGE, context.packageName)
    values.put(Events.CUSTOM_APP_URI, appUri)
  }

  // Should a provider refuse the app columns, write the event without them.
  private fun <T> withAppFallback(values: ContentValues, op: (ContentValues) -> T): T =
    try {
      op(values)
    } catch (e: IllegalArgumentException) {
      if (!values.containsKey(Events.CUSTOM_APP_PACKAGE)) throw e
      op(ContentValues(values).apply {
        remove(Events.CUSTOM_APP_PACKAGE)
        remove(Events.CUSTOM_APP_URI)
      })
    }

  private fun hex(color: Int) = String.format("#%06X", 0xFFFFFF and color)
}

private fun Cursor.opt(i: Int): Any? = if (isNull(i)) null else getString(i)
private fun Cursor.optLong(i: Int): Long? = if (isNull(i)) null else getLong(i)
