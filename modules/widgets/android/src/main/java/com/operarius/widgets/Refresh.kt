package com.operarius.widgets

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
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
   * ending (the "now" mark, the highlighted task), a quarter hour at the latest
   * (the time next to "now"), and midnight (a new day). Inexact, so it never
   * wakes the phone — it redraws the next time the phone is awake.
   */
  fun schedule(ctx: Context) {
    val am = ctx.getSystemService(AlarmManager::class.java) ?: return
    val pi = PendingIntent.getBroadcast(
      ctx,
      0x7D1,
      Intent(ctx, TodayWidget::class.java).setAction(ACTION_TICK),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    if (ids(ctx, TodayWidget::class.java).isEmpty() && ids(ctx, MonthWidget::class.java).isEmpty()) {
      am.cancel(pi)
      return
    }
    val now = System.currentTimeMillis()
    val day = Days.midnight()
    var next = (day.clone() as Calendar).apply { add(Calendar.DAY_OF_MONTH, 1) }.timeInMillis + 1000
    if (ids(ctx, TodayWidget::class.java).isNotEmpty()) {
      next = minOf(next, now + 15 * 60_000L)
      val tasks = Snapshot.load(ctx)?.days?.get(Days.key(day)).orEmpty()
      for (t in tasks) {
        if (t.allDay) continue
        for (m in intArrayOf(t.start, t.start + t.dur)) {
          val at = day.timeInMillis + m * 60_000L
          if (at > now + 20_000L) next = minOf(next, at)
        }
      }
    }
    am.set(AlarmManager.RTC, maxOf(next, now + 30_000L), pi)
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
