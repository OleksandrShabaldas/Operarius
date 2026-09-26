package com.operarius.widgets

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.widget.RemoteViews

/** Today's timeline on the home screen, from the now line on. */
class TodayWidget : AppWidgetProvider() {
  override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
    for (id in ids) render(ctx, mgr, id)
    Refresh.schedule(ctx)
  }

  override fun onAppWidgetOptionsChanged(ctx: Context, mgr: AppWidgetManager, id: Int, opts: Bundle) {
    render(ctx, mgr, id)
  }

  override fun onDisabled(ctx: Context) {
    Refresh.schedule(ctx) // (cancels the ticks when no widget is left)
  }

  override fun onReceive(ctx: Context, intent: Intent) {
    super.onReceive(ctx, intent)
    when (intent.action) {
      // (the redraw ticks come here for every widget: Refresh.schedule)
      Refresh.ACTION_TICK, Intent.ACTION_TIME_CHANGED, Intent.ACTION_TIMEZONE_CHANGED -> Refresh.all(ctx)
    }
  }

  companion object {
    fun render(ctx: Context, mgr: AppWidgetManager, id: Int) {
      val rv = RemoteViews(ctx.packageName, R.layout.operarius_widget_today)
      TodayView.fill(ctx, id, rv)
      mgr.updateAppWidget(id, rv)
      mgr.notifyAppWidgetViewDataChanged(id, R.id.t_list)
    }
  }
}
