package com.operarius.reminders

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import java.util.Calendar

/**
 * AlarmManager bookkeeping.
 *
 *  • medium / intense → setAlarmClock: a real alarm — exact, wakes the phone
 *    out of Doze, never deferred by battery saving (and shown as the next alarm).
 *  • easy → setExactAndAllowWhileIdle: exact, fires in Doze, no alarm icon.
 *  • Without exact-alarm access (only possible on Android 12 / 12L) it falls
 *    back to an inexact while-idle alarm rather than not reminding at all.
 */
internal object Scheduler {
  const val ACTION_FIRE = "com.operarius.reminders.action.FIRE"
  private const val HOUR = 3_600_000L

  /** The first sync in a process re-arms everything (alarms don't survive a force-stop). */
  @Volatile private var primed = false

  private fun am(ctx: Context) = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager

  fun canExact(ctx: Context): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am(ctx).canScheduleExactAlarms()

  private fun fireIntent(ctx: Context, id: String): Intent =
    Intent(ctx, ReminderReceiver::class.java)
      .setAction(ACTION_FIRE)
      .setData(Uri.Builder().scheme("operarius-reminder").authority("fire").appendPath(id).build())
      .putExtra(ReminderReceiver.EXTRA_ID, id)

  private fun firePending(ctx: Context, id: String, create: Boolean): PendingIntent? =
    PendingIntent.getBroadcast(
      ctx,
      0,
      fireIntent(ctx, id),
      (if (create) PendingIntent.FLAG_UPDATE_CURRENT else PendingIntent.FLAG_NO_CREATE) or PendingIntent.FLAG_IMMUTABLE
    )

  fun arm(ctx: Context, r: Reminder) {
    val pi = firePending(ctx, r.id, true) ?: return
    val am = am(ctx)
    try {
      when {
        !canExact(ctx) -> am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, r.at, pi)
        r.isScreen -> am.setAlarmClock(AlarmManager.AlarmClockInfo(r.at, Intents.openAppPending(ctx, r)), pi)
        else -> am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, r.at, pi)
      }
    } catch (_: SecurityException) {
      am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, r.at, pi)
    }
  }

  fun disarm(ctx: Context, id: String) {
    firePending(ctx, id, false)?.let {
      am(ctx).cancel(it)
      it.cancel()
    }
  }

  /**
   * Makes the schedule match what the app sent. Snoozes and tests (scheduled
   * here) stay unless their task occurrence is gone or done (`live`).
   */
  @Synchronized
  fun sync(ctx: Context, items: List<Reminder>, live: Set<String>) {
    val now = System.currentTimeMillis()
    val stored = Store.all(ctx)
    val incoming = items.filter { it.at > now }.distinctBy { it.id }
    val nextIds = incoming.mapTo(HashSet()) { it.id }
    val keep = stored.filter { it.native && it.at > now && (it.isTest || it.taskKey in live) && it.id !in nextIds }
    val keepIds = keep.mapTo(HashSet()) { it.id }

    for (s in stored) if (s.id !in nextIds && s.id !in keepIds) disarm(ctx, s.id)
    val before = stored.associateBy { it.id }
    for (r in incoming) {
      val o = before[r.id]
      if (!primed || o == null || o.at != r.at || o.intensity != r.intensity || o.native) arm(ctx, r)
    }
    if (!primed) keep.forEach { arm(ctx, it) }
    primed = true
    Store.saveAll(ctx, incoming + keep)
  }

  /**
   * After a reboot, an app update or a clock / time-zone change: rebuild every
   * alarm from its local wall time. Reminders that came due while the phone
   * was off are shown as missed.
   */
  @Synchronized
  fun rearmAll(ctx: Context, afterBoot: Boolean) {
    val now = System.currentTimeMillis()
    val next = ArrayList<Reminder>()
    val missed = ArrayList<Reminder>()
    for (r0 in Store.all(ctx)) {
      val at = r0.wall?.let { wallToMs(it) } ?: r0.at
      val shift = at - r0.at
      val r = if (shift == 0L) r0 else r0.copy(
        at = at,
        startAt = if (r0.startAt > 0) r0.startAt + shift else 0,
        endAt = if (r0.endAt > 0) r0.endAt + shift else 0,
      )
      if (r.at > now) next += r else missed += r
    }
    next.forEach { arm(ctx, it) }
    primed = true
    Store.saveAll(ctx, next)
    if (afterBoot) {
      val cfg = Store.config(ctx)
      if (cfg.enabled) missed.filter { now - it.at < 12 * HOUR && !it.isTest }.forEach { Notifications.showMissed(ctx, it) }
    }
  }

  /** "2026-09-23T11:20" in the phone's current time zone. */
  fun wallToMs(wall: String): Long? = try {
    val (d, t) = wall.split('T')
    val (y, mo, day) = d.split('-').map { it.toInt() }
    val (h, mi) = t.split(':').map { it.toInt() }
    Calendar.getInstance().apply {
      clear()
      set(y, mo - 1, day, h, mi, 0)
    }.timeInMillis
  } catch (_: Exception) {
    null
  }
}
