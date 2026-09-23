package com.operarius.reminders

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.WindowManager
import android.window.OnBackInvokedDispatcher
import androidx.core.view.WindowCompat

/**
 * Hosts the reminder screen over the lock screen (launched by the full-screen
 * notification, or directly while the app itself is open). It lives in its own
 * task, so closing it drops you back exactly where you were.
 */
class AlarmActivity : Activity(), AlarmView.Listener, AlarmBus.Listener {
  companion object {
    private const val EXTRA = "reminder"

    fun intent(ctx: Context, r: Reminder): Intent =
      Intent(ctx, AlarmActivity::class.java)
        .putExtra(EXTRA, r.toString())
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_USER_ACTION)
  }

  private var view: AlarmView? = null
  private var reminder: Reminder? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (Build.VERSION.SDK_INT >= 27) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    } else {
      @Suppress("DEPRECATION")
      window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    WindowCompat.setDecorFitsSystemWindows(window, false)
    if (!bind(intent)) {
      finish()
      return
    }
    AlarmBus.add(this)
    if (Build.VERSION.SDK_INT >= 33) {
      onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { view?.onBack() }
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    val r = Reminder.parse(intent.getStringExtra(EXTRA))
    if (r != null && r.id != reminder?.id) bind(intent)
  }

  /** Shows the reminder in the intent — unless it was already answered elsewhere. */
  private fun bind(i: Intent): Boolean {
    val r = Reminder.parse(i.getStringExtra(EXTRA)) ?: return false
    if (AlarmService.current?.id != r.id) return false
    reminder = r
    val v = AlarmView(this, r, Store.config(this), overlay = false, listener = this)
    view = v
    setContentView(v)
    if (AlarmService.silenced) v.showSilenced(animated = false)
    return true
  }

  override fun onDestroy() {
    AlarmBus.remove(this)
    super.onDestroy()
  }

  @Deprecated("Needed while the app opts out of predictive back")
  override fun onBackPressed() {
    view?.onBack()
  }

  override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
    val volume = keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN
    if (volume && reminder?.isIntense == true && !AlarmService.silenced) {
      AlarmService.silence()
      return true
    }
    return super.onKeyDown(keyCode, event)
  }

  // ---- AlarmView.Listener ---------------------------------------------------------

  override fun onDismiss() {
    reminder?.let { Alarms.dismiss(this, it) }
  }

  override fun onSnooze() {
    reminder?.let { Alarms.snooze(this, it) }
  }

  override fun onDone() {
    reminder?.let { Alarms.done(this, it) }
  }

  override fun onSilence() = AlarmService.silence()

  override fun onFinished() {
    if (!isFinishing) finish()
  }

  /** Opens the task — asking to unlock first when the phone is locked. */
  override fun onOpen() {
    val r = reminder ?: return
    val km = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    val open = {
      Alarms.dismiss(this, r)
      try {
        startActivity(Intents.openApp(this, r))
      } catch (_: Exception) {
        Intents.launchApp(this)?.let { startActivity(it) }
      }
      finish()
    }
    if (Build.VERSION.SDK_INT >= 26 && km.isKeyguardLocked) {
      km.requestDismissKeyguard(this, object : KeyguardManager.KeyguardDismissCallback() {
        override fun onDismissSucceeded() = open()
      })
    } else open()
  }

  // ---- AlarmBus.Listener ----------------------------------------------------------

  override fun onAlarmClosed(id: String) {
    if (id != reminder?.id) return
    val v = view
    if (v == null) finish() else v.playOutro(AlarmView.Outro.FADE) { if (!isFinishing) finish() }
  }

  override fun onAlarmSilenced(id: String) {
    if (id == reminder?.id) view?.showSilenced()
  }
}
