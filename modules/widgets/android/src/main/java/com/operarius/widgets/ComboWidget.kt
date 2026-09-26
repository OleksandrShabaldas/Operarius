package com.operarius.widgets

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews

/**
 * Today & Month: today's timeline and the month in one widget, switched with the
 * Today / Month switch at its top. Both are drawn every time, so switching is
 * instant: the switch's pill glides across, its labels and the buttons beside it
 * cross-fade, and one view sinks away as the other rises in.
 */
class ComboWidget : AppWidgetProvider() {
  override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
    for (id in ids) render(ctx, mgr, id)
    Refresh.schedule(ctx)
  }

  override fun onAppWidgetOptionsChanged(ctx: Context, mgr: AppWidgetManager, id: Int, opts: Bundle) {
    render(ctx, mgr, id)
  }

  override fun onDeleted(ctx: Context, ids: IntArray) {
    val e = Snapshot.prefs(ctx).edit()
    for (id in ids) e.remove(modeKey(id)).remove(MonthView.offsetKey(id))
    e.apply()
  }

  override fun onDisabled(ctx: Context) {
    Refresh.schedule(ctx)
  }

  override fun onReceive(ctx: Context, intent: Intent) {
    super.onReceive(ctx, intent)
    val id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
    if (id == AppWidgetManager.INVALID_APPWIDGET_ID) return
    val mgr = AppWidgetManager.getInstance(ctx)
    if (intent.action == ACTION_MODE) show(ctx, mgr, id, intent.getIntExtra(EXTRA_MODE, 0))
    else if (MonthView.step(ctx, id, intent.action)) render(ctx, mgr, id)
  }

  companion object {
    private const val ACTION_MODE = "com.operarius.widgets.COMBO_MODE"
    private const val EXTRA_MODE = "mode"
    private const val TODAY = 0
    private const val MONTH = 1

    private fun modeKey(id: Int) = "combo_mode_$id"

    // Narrower than this (dp), the top row keeps just the switch and the buttons.
    private const val NARROW = 290

    // Header + margin + the month's title and weekdays, around the grid (for MonthView's fit).
    private const val MONTH_FIXED = 68f
    private const val MONTH_SCALED = 36f

    fun render(ctx: Context, mgr: AppWidgetManager, id: Int) {
      val rv = RemoteViews(ctx.packageName, R.layout.operarius_widget_combo)
      val mode = Snapshot.prefs(ctx).getInt(modeKey(id), TODAY)

      // The side showing. (Set as plain visibility: re-setting a flipper's child
      // would replay its animation on every redraw — the flippers only animate
      // a switch, in show().)
      val today = mode == TODAY
      fun vis(viewId: Int, on: Boolean) = rv.setViewVisibility(viewId, if (on) View.VISIBLE else View.GONE)
      vis(R.id.c_pl, today)
      vis(R.id.c_pr, !today)
      vis(R.id.c_l0, today)
      vis(R.id.c_l1, !today)
      vis(R.id.c_a0, today)
      vis(R.id.c_a1, !today)
      vis(R.id.c_today, today)
      vis(R.id.c_month, !today)

      // Either side of the switch, in either state, shows its view.
      for ((viewId, to) in listOf(R.id.c_t0 to TODAY, R.id.c_t1 to TODAY, R.id.c_m0 to MONTH, R.id.c_m1 to MONTH)) rv.setOnClickPendingIntent(viewId, mode(ctx, id, to))

      TodayView.fill(ctx, id, rv)
      MonthView.fill(ctx, mgr, id, rv, ComboWidget::class.java, MONTH_FIXED, MONTH_SCALED)

      // Narrow (the switch takes most of the top row): the count and the month's
      // "Today" step aside — tapping Month again goes back to this month too.
      val width = mgr.getAppWidgetOptions(id).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0)
      if (width in 1 until NARROW) {
        rv.setViewVisibility(R.id.t_count, View.GONE)
        rv.setViewVisibility(R.id.m_today, View.GONE)
      }
      mgr.updateAppWidget(id, rv)
      mgr.notifyAppWidgetViewDataChanged(id, R.id.t_list)
    }

    /** Switches to `to`: every flipper animates to it together (a partial update, so nothing else redraws). */
    private fun show(ctx: Context, mgr: AppWidgetManager, id: Int, to: Int) {
      if (to != TODAY && to != MONTH) return
      val p = Snapshot.prefs(ctx)
      if (p.getInt(modeKey(id), TODAY) == to) {
        // The side already showing: Month goes back to this month, Today back up to the now line.
        if (to == MONTH) {
          if (p.getInt(MonthView.offsetKey(id), 0) != 0 && MonthView.step(ctx, id, MonthView.ACTION_TODAY)) render(ctx, mgr, id)
        } else {
          mgr.partiallyUpdateAppWidget(id, RemoteViews(ctx.packageName, R.layout.operarius_widget_combo).apply { setScrollPosition(R.id.t_list, 0) })
        }
        return
      }
      p.edit().putInt(modeKey(id), to).apply()
      val rv = RemoteViews(ctx.packageName, R.layout.operarius_widget_combo)
      for (f in intArrayOf(R.id.c_p0, R.id.c_p1, R.id.c_lbl, R.id.c_act, R.id.c_flip)) rv.setDisplayedChild(f, to)
      mgr.partiallyUpdateAppWidget(id, rv)
    }

    private fun mode(ctx: Context, id: Int, to: Int): PendingIntent =
      PendingIntent.getBroadcast(
        ctx,
        id * 8 + 5 + to,
        Intent(ctx, ComboWidget::class.java).setAction(ACTION_MODE).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id).putExtra(EXTRA_MODE, to),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
  }
}
