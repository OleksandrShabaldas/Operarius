package com.operarius.reminders

import android.content.Context

/** What happens when a reminder fires, and when you answer it (from anywhere). */
internal object Alarms {
  private const val MIN = 60_000L

  fun fire(ctx: Context, r: Reminder) {
    val cfg = Store.config(ctx)
    if (!cfg.enabled && !r.isTest) return
    if (r.isScreen) AlarmService.start(ctx, r) else Notifications.showReminder(ctx, r)
  }

  /** The task is done: tell the app, and drop the occurrence's other pending reminders. */
  fun done(ctx: Context, r: Reminder) {
    if (!r.isTest) {
      Store.pushAction(ctx, "done", r)
      Store.removeWhere(ctx) { it.taskKey == r.taskKey }.forEach { Scheduler.disarm(ctx, it.id) }
      RemindersModule.signal()
    }
    close(ctx, r)
  }

  fun snooze(ctx: Context, r: Reminder) {
    val cfg = Store.config(ctx)
    val s = r.copy(
      id = r.id.substringBefore('#') + "#snooze",
      at = System.currentTimeMillis() + cfg.snoozeMin * MIN,
      wall = null,
      native = true,
      snoozes = r.snoozes + 1,
    )
    Store.put(ctx, s)
    Scheduler.arm(ctx, s)
    close(ctx, r)
  }

  fun dismiss(ctx: Context, r: Reminder) = close(ctx, r)

  /** When the snooze would ring again (for the screen's "Snoozed until …"). */
  fun snoozeUntil(ctx: Context): Long = System.currentTimeMillis() + Store.config(ctx).snoozeMin * MIN

  private fun close(ctx: Context, r: Reminder) {
    AlarmService.finish(ctx, r.id)
    Notifications.cancel(ctx, r)
  }
}
