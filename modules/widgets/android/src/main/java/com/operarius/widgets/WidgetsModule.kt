package com.operarius.widgets

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.os.Build
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** The JS bridge (modules/widgets/index.ts). */
class WidgetsModule : Module() {
  private val context: Context get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("OperariusWidgets")

    // The latest tasks for the widgets; redraws them.
    AsyncFunction("update") { json: String ->
      val ctx = context
      Snapshot.save(ctx, json)
      Refresh.all(ctx)
      true
    }

    // How many of each are on the home screen, and whether the app can add one.
    AsyncFunction("status") {
      val ctx = context
      val mgr = AppWidgetManager.getInstance(ctx)
      mapOf(
        "today" to Refresh.ids(ctx, TodayWidget::class.java).size,
        "month" to Refresh.ids(ctx, MonthWidget::class.java).size,
        "combo" to Refresh.ids(ctx, ComboWidget::class.java).size,
        "canPin" to (Build.VERSION.SDK_INT >= 26 && mgr.isRequestPinAppWidgetSupported),
      )
    }

    // Asks the launcher to add one (it shows its own confirmation).
    AsyncFunction("pin") { kind: String ->
      val ctx = context
      if (Build.VERSION.SDK_INT < 26) return@AsyncFunction false
      val mgr = AppWidgetManager.getInstance(ctx)
      if (!mgr.isRequestPinAppWidgetSupported) return@AsyncFunction false
      val cls = when (kind) {
        "month" -> MonthWidget::class.java
        "combo" -> ComboWidget::class.java
        else -> TodayWidget::class.java
      }
      mgr.requestPinAppWidget(ComponentName(ctx, cls), null, null)
    }
  }
}
