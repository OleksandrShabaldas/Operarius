package com.operarius.reminders

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** The JS bridge (modules/reminders/index.ts). */
class RemindersModule : Module() {
  companion object {
    private const val PICK_SOUND = 0x0A1A
    @Volatile private var instance: RemindersModule? = null

    /** Something was done outside the app ("Done" on a notification) — let a running app pick it up now. */
    fun signal() {
      val m = instance ?: return
      try {
        m.sendEvent("onAction", mapOf("type" to "signal"))
      } catch (_: Throwable) {
      }
    }
  }

  private var pickPromise: Promise? = null
  private val context: Context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("OperariusReminders")
    Events("onAction")

    OnCreate {
      instance = this@RemindersModule
      appContext.reactContext?.let { Notifications.ensureChannels(it) }
    }

    OnDestroy {
      if (instance === this@RemindersModule) instance = null
    }

    AsyncFunction("sync") { items: List<ReminderRecord>, live: List<String>, config: ConfigRecord ->
      val ctx = context
      Store.saveConfig(ctx, config.toConfig())
      Scheduler.sync(ctx, items.map { it.toReminder() }, live.toHashSet())
    }

    AsyncFunction("getStatus") {
      Status.get(context)
    }

    AsyncFunction("requestNotifications") { promise: Promise ->
      val ctx = context
      if (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
        promise.resolve(NotificationManagerCompat.from(ctx).areNotificationsEnabled())
        return@AsyncFunction
      }
      val perms = appContext.permissions
      if (perms == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      perms.askForPermissions({ result ->
        promise.resolve(result[Manifest.permission.POST_NOTIFICATIONS]?.status == PermissionsStatus.GRANTED)
      }, Manifest.permission.POST_NOTIFICATIONS)
    }

    AsyncFunction("openSettings") { target: String ->
      Status.open(appContext.currentActivity ?: context, target)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("test") { sample: ReminderRecord, delaySec: Int ->
      val ctx = context
      val base = sample.toReminder()
      val r = base.copy(
        id = "__test#" + base.intensity,
        taskKey = Reminder.TEST_KEY,
        at = System.currentTimeMillis() + delaySec.coerceIn(1, 3600) * 1000L,
        wall = null,
        native = true,
      )
      Store.put(ctx, r)
      Scheduler.arm(ctx, r)
    }

    AsyncFunction("takeActions") {
      Store.takeActions(context)
    }

    AsyncFunction("pickSound") { current: String?, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      pickPromise?.resolve(null)
      pickPromise = promise
      val existing = current?.let { runCatching { Uri.parse(it) }.getOrNull() } ?: Settings.System.DEFAULT_ALARM_ALERT_URI
      val intent = Intent(RingtoneManager.ACTION_RINGTONE_PICKER)
        .putExtra(RingtoneManager.EXTRA_RINGTONE_TYPE, RingtoneManager.TYPE_ALARM)
        .putExtra(RingtoneManager.EXTRA_RINGTONE_TITLE, "Alarm sound")
        .putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, true)
        .putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, false)
        .putExtra(RingtoneManager.EXTRA_RINGTONE_DEFAULT_URI, Settings.System.DEFAULT_ALARM_ALERT_URI)
        .putExtra(RingtoneManager.EXTRA_RINGTONE_EXISTING_URI, existing)
      try {
        activity.startActivityForResult(intent, PICK_SOUND)
      } catch (_: Exception) {
        pickPromise = null
        promise.resolve(null)
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("soundName") { uri: String? ->
      Sounds.name(context, uri)
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != PICK_SOUND) return@OnActivityResult
      val promise = pickPromise ?: return@OnActivityResult
      pickPromise = null
      if (payload.resultCode != Activity.RESULT_OK) {
        promise.resolve(null)
        return@OnActivityResult
      }
      val picked: Uri? = if (Build.VERSION.SDK_INT >= 33) {
        payload.data?.getParcelableExtra(RingtoneManager.EXTRA_RINGTONE_PICKED_URI, Uri::class.java)
      } else {
        @Suppress("DEPRECATION") payload.data?.getParcelableExtra(RingtoneManager.EXTRA_RINGTONE_PICKED_URI)
      }
      val ctx = context
      if (picked == null || picked == Settings.System.DEFAULT_ALARM_ALERT_URI) {
        promise.resolve(mapOf("uri" to null, "name" to Sounds.name(ctx, null)))
      } else {
        promise.resolve(mapOf("uri" to picked.toString(), "name" to (Sounds.title(ctx, picked) ?: "Alarm")))
      }
    }
  }
}
