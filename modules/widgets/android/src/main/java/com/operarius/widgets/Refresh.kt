package com.operarius.widgets

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import java.util.Calendar

/** Redrawing the widgets, now and whenever the day moves on. */
internal object Refresh {
  const val ACTION_TICK = "com.operarius.widgets.TICK"

  fun ids(ctx: Context, cls: Class<*>): IntArray =
    try {
      AppWidgetManager.getInstance(ctx).getAppWidgetIds(ComponentName(ctx, cls))
    } catch (_: Exception) {
      IntArray(0)
    }

  /** Redraws every widget on the home screen and books the next redraw. */
  fun all(ctx: Context) {
    val mgr = AppWidgetManager.getInstance(ctx)
    for (id in ids(ctx, TodayWidget::class.java)) TodayWidget.render(ctx, mgr, id)
    for (id in ids(ctx, MonthWidget::class.java)) MonthWidget.render(ctx, mgr, id)
    schedule(ctx)
  }

  /**
   * The next moment something on a widget changes: a task of today starting or
   * ending (it joins or leaves the timeline, the now line moves onto it), the
   * day's start or end, every few minutes while a task is on (the now line
   * moving across it), and midnight (a new day). On time when the app may set
   * exact alarms (it has them for reminders) — otherwise Android may run it up
   * to 10 minutes late. Never wakes the phone: asleep, it redraws the next time
   * the phone is awake.
   */
  fun schedule(ctx: Context) {
    val am = ctx.getSystemService(AlarmManager::class.java) ?: return
    val pi = PendingIntent.getBroadcast(
      ctx,
      0x7D1,
      Intent(ctx, TodayWidget::class.java).setAction(ACTION_TICK),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val timeline = ids(ctx, TodayWidget::class.java).isNotEmpty()
    if (!timeline && ids(ctx, MonthWidget::class.java).isEmpty()) {
      am.cancel(pi)
      return
    }
    val now = System.currentTimeMillis()
    val day = Days.midnight()
    var next = (day.clone() as Calendar).apply { add(Calendar.DAY_OF_MONTH, 1) }.timeInMillis + 1000
    var window = 60_000L
    if (timeline) {
      next = minOf(next, now + 30 * 60_000L) // a fallback, should an alarm be missed
      val snap = Snapshot.load(ctx)
      val nowMin = Days.nowMin()
      val marks = ArrayList<Int>()
      snap?.let {
        marks += it.dayStart
        marks += it.dayEnd
      }
      var on = false
      for (t in snap?.days?.get(Days.key(day)).orEmpty()) {
        if (t.allDay) continue
        marks += t.start
        marks += t.start + t.dur
        if (t.start <= nowMin && t.start + t.dur > nowMin) on = true
      }
      for (m in marks) {
        val at = day.timeInMillis + m * 60_000L
        if (at > now + 20_000L && at < next) {
          next = at
          window = 20_000L
        }
      }
      if (on && now + 5 * 60_000L < next) {
        next = now + 5 * 60_000L
        window = 60_000L
      }
    }
    val at = maxOf(next, now + 30_000L)
    val exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()
    if (exact) am.setExact(AlarmManager.RTC, at, pi) else am.setWindow(AlarmManager.RTC, at, window, pi)
  }

  /** Opens the app at `uri` (a task, a day, a new task). */
  fun open(ctx: Context, uri: String, code: Int): PendingIntent =
    PendingIntent.getActivity(
      ctx,
      code,
      Intent(Intent.ACTION_VIEW, Uri.parse(uri)).setPackage(ctx.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
}
