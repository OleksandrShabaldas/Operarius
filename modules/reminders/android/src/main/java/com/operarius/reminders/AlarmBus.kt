package com.operarius.reminders

import android.os.Handler
import android.os.Looper
import java.util.concurrent.CopyOnWriteArraySet

/** Tells open reminder screens (activity / overlay) what happened elsewhere. */
internal object AlarmBus {
  interface Listener {
    fun onAlarmClosed(id: String) {}
    fun onAlarmSilenced(id: String) {}
  }

  private val listeners = CopyOnWriteArraySet<Listener>()
  private val main = Handler(Looper.getMainLooper())

  fun add(l: Listener) {
    listeners.add(l)
  }

  fun remove(l: Listener) {
    listeners.remove(l)
  }

  fun closed(id: String) = onMain { listeners.forEach { it.onAlarmClosed(id) } }
  fun silenced(id: String) = onMain { listeners.forEach { it.onAlarmSilenced(id) } }

  private fun onMain(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) block() else main.post(block)
  }
}
