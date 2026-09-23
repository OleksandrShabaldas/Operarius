package com.operarius.reminders

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri

/** Every PendingIntent the reminders hand to the system. */
internal object Intents {
  private const val IMMUTABLE = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

  /** Opens the app on the task: operarius://task?key=<task>&date=<day>. */
  fun openApp(ctx: Context, r: Reminder): Intent {
    val uri = Uri.parse("operarius://task").buildUpon()
      .appendQueryParameter("key", r.taskKey)
      .apply { r.date?.let { appendQueryParameter("date", it) } }
      .build()
    return Intent(Intent.ACTION_VIEW, uri)
      .setPackage(ctx.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
  }

  fun openAppPending(ctx: Context, r: Reminder): PendingIntent =
    PendingIntent.getActivity(ctx, code(r, "open"), openApp(ctx, r), IMMUTABLE)

  /** The app itself (no task) — used when nothing more specific applies. */
  fun launchApp(ctx: Context): Intent? =
    ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

  /** Done / Snooze / Dismiss on a notification. */
  fun action(ctx: Context, r: Reminder, action: String): PendingIntent {
    val i = Intent(ctx, ReminderReceiver::class.java)
      .setAction(action)
      .setData(Uri.Builder().scheme("operarius-reminder").authority(action.substringAfterLast('.').lowercase()).appendPath(r.id).build())
      .putExtra(ReminderReceiver.EXTRA_REMINDER, r.toString())
    return PendingIntent.getBroadcast(ctx, code(r, action), i, IMMUTABLE)
  }

  /** The reminder screen (full-screen intent / tapping the ongoing notification). */
  fun screen(ctx: Context, r: Reminder): PendingIntent =
    PendingIntent.getActivity(ctx, code(r, "screen"), AlarmActivity.intent(ctx, r), IMMUTABLE)

  private fun code(r: Reminder, what: String) = (r.id + "|" + what).hashCode()
}
