package com.operarius.reminders

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/**
 * Channels and notifications.
 *
 *  • Reminders            — easy reminders: a normal heads-up notification with sound.
 *  • Full-screen reminders — medium / intense: wakes the screen with the reminder
 *                            screen. Silent itself: the app plays the buzz / alarm.
 *  • Reminder on screen    — the quiet shade entry (with its buttons) while the
 *                            reminder screen is already showing over another app.
 *  • Missed reminders      — couldn't ring (phone off) or gave up ringing.
 */
internal object Notifications {
  const val CH_REMINDERS = "operarius_reminders"
  const val CH_ALARMS = "operarius_alarms"
  const val CH_ACTIVE = "operarius_alarm_active"
  const val CH_MISSED = "operarius_missed"
  const val ALARM_ID = 7331

  fun ensureChannels(ctx: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
    val reminders = NotificationChannel(CH_REMINDERS, "Reminders", NotificationManager.IMPORTANCE_HIGH).apply {
      description = "Easy reminders — a notification before a task, after it, or at a set time."
      enableVibration(true)
      enableLights(true)
      lightColor = Palette.ACCENT_B
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      setSound(
        RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
        AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
      )
    }
    val alarms = NotificationChannel(CH_ALARMS, "Full-screen reminders", NotificationManager.IMPORTANCE_HIGH).apply {
      description = "Medium and intense reminders. They light up the screen; Operarius plays the buzz or the alarm itself."
      setSound(null, null)
      enableVibration(false)
      setBypassDnd(true)
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    }
    val active = NotificationChannel(CH_ACTIVE, "Reminder on screen", NotificationManager.IMPORTANCE_LOW).apply {
      description = "Sits in the shade with its buttons while a reminder screen is open."
      setSound(null, null)
      enableVibration(false)
      setShowBadge(false)
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    }
    val missed = NotificationChannel(CH_MISSED, "Missed reminders", NotificationManager.IMPORTANCE_DEFAULT).apply {
      description = "Reminders that couldn't ring because the phone was off, or that rang without an answer."
      setSound(null, null)
      enableVibration(false)
    }
    nm.createNotificationChannels(listOf(reminders, alarms, active, missed))
  }

  /** Is anything stopping our notifications from showing at all? */
  fun enabled(ctx: Context): Boolean {
    if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) return false
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val nm = ctx.getSystemService(NotificationManager::class.java) ?: return true
      for (id in listOf(CH_REMINDERS, CH_ALARMS)) {
        val ch = nm.getNotificationChannel(id) ?: continue
        if (ch.importance == NotificationManager.IMPORTANCE_NONE) return false
      }
    }
    return true
  }

  /** One notification per task occurrence — a later reminder for it replaces the earlier one. */
  fun idFor(r: Reminder): Int = 0x4000_0000 or (r.taskKey.hashCode() and 0x0FFF_FFFF)

  private fun canPost(ctx: Context): Boolean =
    Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

  private fun post(ctx: Context, id: Int, n: Notification) {
    if (!canPost(ctx)) return
    try {
      NotificationManagerCompat.from(ctx).notify(id, n)
    } catch (_: SecurityException) {
    }
  }

  private fun base(ctx: Context, r: Reminder, channel: String): NotificationCompat.Builder =
    NotificationCompat.Builder(ctx, channel)
      .setSmallIcon(R.drawable.operarius_ic_bell)
      .setLargeIcon(Graphics.taskIcon(ctx, r))
      .setColor(Palette.parse(r.color))
      .setContentTitle(r.title.ifBlank { "Reminder" })
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setWhen(System.currentTimeMillis())
      .setShowWhen(true)

  /** Easy reminder — or a medium / intense one that couldn't take the screen. */
  fun showReminder(ctx: Context, r: Reminder) {
    ensureChannels(ctx)
    val cfg = Store.config(ctx)
    val text = Texts.body(r)
    val big = if (r.detail.isNotBlank()) "$text\n${r.detail}" else text
    val n = base(ctx, r, CH_REMINDERS)
      .setContentText(text)
      .setStyle(NotificationCompat.BigTextStyle().bigText(big))
      .setCategory(NotificationCompat.CATEGORY_REMINDER)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setAutoCancel(true)
      .setContentIntent(Intents.openAppPending(ctx, r))
      .apply { finishAction(ctx, r) }
      .addAction(R.drawable.operarius_ic_clock, "Snooze ${cfg.snoozeMin} min", Intents.action(ctx, r, ReminderReceiver.ACTION_SNOOZE))
      .build()
    post(ctx, idFor(r), n)
  }

  /**
   * "Done" — or, while subtasks are still open (a task only completes with
   * them), "Open" to go tick them off.
   */
  private fun NotificationCompat.Builder.finishAction(ctx: Context, r: Reminder) {
    if (r.subsLeft > 0) addAction(R.drawable.operarius_ic_arrow_up_right, "Open · ${r.subsLeft} left", Intents.openAndDismiss(ctx, r))
    else addAction(R.drawable.operarius_ic_check, "Done", Intents.action(ctx, r, ReminderReceiver.ACTION_DONE))
  }

  /** A reminder that couldn't ring (phone off) or rang without an answer. */
  fun showMissed(ctx: Context, r: Reminder, rangFor: Long = 0) {
    ensureChannels(ctx)
    val cfg = Store.config(ctx)
    val due = Texts.time(r.at, cfg.clock24)
    val text = if (rangFor > 0) "Rang for ${Texts.dur(rangFor)} without an answer · due $due" else "Missed · was due $due"
    val n = base(ctx, r, CH_MISSED)
      .setContentText(text)
      .setSubText(r.timeText.takeIf { it.isNotBlank() && it != "To-do" })
      .setCategory(NotificationCompat.CATEGORY_REMINDER)
      .setPriority(NotificationCompat.PRIORITY_DEFAULT)
      .setAutoCancel(true)
      .setContentIntent(Intents.openAppPending(ctx, r))
      .apply { finishAction(ctx, r) }
      .addAction(R.drawable.operarius_ic_clock, "Snooze ${cfg.snoozeMin} min", Intents.action(ctx, r, ReminderReceiver.ACTION_SNOOZE))
      .build()
    post(ctx, idFor(r), n)
  }

  /**
   * The ringing / showing reminder's notification (the foreground service's).
   * `fullScreen` = wake the screen with the reminder screen (locked / asleep);
   * otherwise our own screen is already up and this just sits in the shade.
   */
  fun alarm(ctx: Context, r: Reminder, fullScreen: Boolean, silenced: Boolean): Notification {
    ensureChannels(ctx)
    val cfg = Store.config(ctx)
    val text = if (silenced) "Silenced · ${Texts.body(r)}" else Texts.body(r)
    val b = base(ctx, r, if (fullScreen) CH_ALARMS else CH_ACTIVE)
      .setContentText(text)
      .setStyle(NotificationCompat.BigTextStyle().bigText(if (r.detail.isNotBlank()) "$text\n${r.detail}" else text))
      .setCategory(NotificationCompat.CATEGORY_ALARM)
      .setPriority(if (fullScreen) NotificationCompat.PRIORITY_MAX else NotificationCompat.PRIORITY_LOW)
      .setOngoing(true)
      .setAutoCancel(false)
      .setOnlyAlertOnce(true)
      .setContentIntent(Intents.screen(ctx, r))
      .setDeleteIntent(Intents.action(ctx, r, ReminderReceiver.ACTION_DISMISS))
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .addAction(R.drawable.operarius_ic_x, if (r.isIntense) "Stop" else "Dismiss", Intents.action(ctx, r, ReminderReceiver.ACTION_DISMISS))
      .addAction(R.drawable.operarius_ic_clock, "Snooze ${cfg.snoozeMin} min", Intents.action(ctx, r, ReminderReceiver.ACTION_SNOOZE))
      .apply { finishAction(ctx, r) }
    if (fullScreen) b.setFullScreenIntent(Intents.screen(ctx, r), true)
    return b.build()
  }

  fun update(ctx: Context, id: Int, n: Notification) = post(ctx, id, n)

  fun cancel(ctx: Context, r: Reminder) {
    NotificationManagerCompat.from(ctx).cancel(idFor(r))
  }
}
