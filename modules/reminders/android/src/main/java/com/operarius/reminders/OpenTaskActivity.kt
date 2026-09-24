package com.operarius.reminders

import android.app.Activity
import android.os.Bundle

/**
 * "Open" on a reminder notification: quiets the reminder (stops a ringing
 * alarm, clears its notification) and opens the task in the app. An invisible
 * hop, because a notification button may only launch an activity directly.
 */
class OpenTaskActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val r = Reminder.parse(intent.getStringExtra(ReminderReceiver.EXTRA_REMINDER))
    if (r != null) {
      Alarms.dismiss(this, r)
      try {
        startActivity(Intents.openApp(this, r))
      } catch (_: Exception) {
        Intents.launchApp(this)?.let { startActivity(it) }
      }
    }
    finish()
    @Suppress("DEPRECATION") overridePendingTransition(0, 0)
  }
}
