package com.operarius.reminders

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** An alarm going off, or a button pressed on a reminder notification. */
class ReminderReceiver : BroadcastReceiver() {
  companion object {
    const val EXTRA_ID = "id"
    const val EXTRA_REMINDER = "reminder"
    const val ACTION_DONE = "com.operarius.reminders.action.DONE"
    const val ACTION_SNOOZE = "com.operarius.reminders.action.SNOOZE"
    const val ACTION_DISMISS = "com.operarius.reminders.action.DISMISS"
  }

  override fun onReceive(ctx: Context, intent: Intent) {
    when (intent.action) {
      Scheduler.ACTION_FIRE -> {
        val id = intent.getStringExtra(EXTRA_ID) ?: return
        // Gone = cancelled by a sync after the alarm was already on its way.
        val r = Store.take(ctx, id) ?: return
        Alarms.fire(ctx, r)
      }
      ACTION_DONE, ACTION_SNOOZE, ACTION_DISMISS -> {
        val r = Reminder.parse(intent.getStringExtra(EXTRA_REMINDER)) ?: return
        when (intent.action) {
          ACTION_DONE -> Alarms.done(ctx, r)
          ACTION_SNOOZE -> Alarms.snooze(ctx, r)
          else -> Alarms.dismiss(ctx, r)
        }
      }
    }
  }
}
