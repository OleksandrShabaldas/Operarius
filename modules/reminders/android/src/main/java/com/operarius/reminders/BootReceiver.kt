package com.operarius.reminders

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Alarms don't survive a reboot, and a clock or time-zone change moves the
 * wall time they stand for — so re-arm everything from the stored schedule.
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(ctx: Context, intent: Intent) {
    val boot = when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED, "android.intent.action.QUICKBOOT_POWERON", "com.htc.intent.action.QUICKBOOT_POWERON" -> true
      Intent.ACTION_MY_PACKAGE_REPLACED, Intent.ACTION_TIME_CHANGED, Intent.ACTION_TIMEZONE_CHANGED,
      "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED" -> false
      else -> return
    }
    Notifications.ensureChannels(ctx)
    Scheduler.rearmAll(ctx, afterBoot = boot)
  }
}
