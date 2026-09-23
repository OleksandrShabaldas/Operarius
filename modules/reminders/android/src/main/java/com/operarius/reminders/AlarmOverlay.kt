package com.operarius.reminders

import android.content.Context
import android.graphics.PixelFormat
import android.os.Build
import android.provider.Settings
import android.view.Gravity
import android.view.ContextThemeWrapper
import android.view.WindowManager

/**
 * The reminder screen drawn straight over whatever app you're using (needs
 * "Display over other apps"). Over the lock screen the activity is used instead.
 */
internal object AlarmOverlay {
  private var view: AlarmView? = null
  private var shownId: String? = null
  private var wm: WindowManager? = null

  private val bus = object : AlarmBus.Listener {
    override fun onAlarmClosed(id: String) {
      if (id == shownId) hide(animated = true)
    }

    override fun onAlarmSilenced(id: String) {
      if (id == shownId) view?.showSilenced()
    }
  }

  fun show(ctx: Context, r: Reminder): Boolean {
    if (!Settings.canDrawOverlays(ctx)) return false
    removeNow()
    val app = ctx.applicationContext
    val manager = app.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    val themed = ContextThemeWrapper(app, R.style.OperariusAlarmTheme)
    val v = AlarmView(themed, r, Store.config(app), overlay = true, listener = object : AlarmView.Listener {
      override fun onDismiss() = Alarms.dismiss(app, r)
      override fun onSnooze() = Alarms.snooze(app, r)
      override fun onDone() = Alarms.done(app, r)
      override fun onSilence() = AlarmService.silence()
      override fun onFinished() = removeNow()
      override fun onOpen() {
        // The overlay is a visible window of ours, so we may start the app from here.
        view?.playOutro(AlarmView.Outro.FADE) { removeNow() }
        Alarms.dismiss(app, r)
        try {
          app.startActivity(Intents.openApp(app, r))
        } catch (_: Exception) {
          Intents.launchApp(app)?.let { app.startActivity(it) }
        }
      }
    })
    val type = if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE
    val lp = WindowManager.LayoutParams(
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.MATCH_PARENT,
      type,
      WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
        WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
        WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
      PixelFormat.TRANSLUCENT
    )
    lp.gravity = Gravity.TOP or Gravity.START
    lp.title = "Operarius reminder"
    if (Build.VERSION.SDK_INT >= 28) lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
    if (Build.VERSION.SDK_INT >= 30) lp.fitInsetsTypes = 0
    return try {
      manager.addView(v, lp)
      wm = manager
      view = v
      shownId = r.id
      AlarmBus.add(bus)
      true
    } catch (_: Exception) {
      false
    }
  }

  /** Closes it — with the fade-out, or at once. */
  fun hide(animated: Boolean) {
    val v = view ?: return
    if (animated) v.playOutro(AlarmView.Outro.FADE) { removeNow() } else removeNow()
  }

  private fun removeNow() {
    val v = view ?: return
    view = null
    shownId = null
    AlarmBus.remove(bus)
    try {
      wm?.removeViewImmediate(v)
    } catch (_: Exception) {
    }
  }
}
