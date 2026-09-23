package com.operarius.reminders

import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToLong

/** The words on notifications and the reminder screen (English, like the app). */
internal object Texts {
  private const val MIN = 60_000L

  /** "10 min", "1h 30m", "2 hr", "1 day" */
  fun dur(ms: Long): String {
    val m = maxOf(1L, (abs(ms).toDouble() / MIN).roundToLong())
    if (m < 60) return "$m min"
    if (m >= 1440) {
      val d = (m.toDouble() / 1440).roundToLong()
      return if (d == 1L) "1 day" else "$d days"
    }
    val h = m / 60
    val mm = m % 60
    return if (mm == 0L) "$h hr" else "${h}h ${mm}m"
  }

  /** What's happening with the task right now: "Starts in 10 min", "Ended 5 min ago", … */
  fun lead(r: Reminder, now: Long = System.currentTimeMillis()): String {
    fun around(edge: Long, soon: String, now0: String, past: String): String {
      val d = edge - now
      return when {
        d > 45_000 -> "$soon ${dur(d)}"
        d > -90_000 -> now0
        else -> "$past ${dur(d)} ago"
      }
    }
    return when {
      r.kind == "after" && r.endAt > 0 -> around(r.endAt, "Ends in", "Ending now", "Ended")
      r.startAt > 0 && (r.endAt <= 0 || now < r.endAt) -> around(r.startAt, "Starts in", "Starting now", "Started")
      r.endAt > 0 -> around(r.endAt, "Ends in", "Ending now", "Ended")
      else -> "Reminder"
    }
  }

  /** "11:20" / "11:20 AM" */
  fun time(ms: Long, clock24: Boolean): String =
    SimpleDateFormat(if (clock24) "HH:mm" else "h:mm a", Locale.US).format(Date(ms))

  /** The big clock: "11:20" + optional "AM". */
  fun clock(ms: Long, clock24: Boolean): Pair<String, String?> {
    if (clock24) return SimpleDateFormat("HH:mm", Locale.US).format(Date(ms)) to null
    return SimpleDateFormat("h:mm", Locale.US).format(Date(ms)) to SimpleDateFormat("a", Locale.US).format(Date(ms))
  }

  /** "Wednesday, September 23" */
  fun date(ms: Long): String = SimpleDateFormat("EEEE, MMMM d", Locale.US).format(Date(ms))

  /** "Today 11:20" / "Tomorrow 07:00" / "Thu 09:00" */
  fun whenShort(ms: Long, clock24: Boolean, now: Long = System.currentTimeMillis()): String {
    val a = Calendar.getInstance().apply { timeInMillis = now }
    val b = Calendar.getInstance().apply { timeInMillis = ms }
    val sameDay = a.get(Calendar.YEAR) == b.get(Calendar.YEAR) && a.get(Calendar.DAY_OF_YEAR) == b.get(Calendar.DAY_OF_YEAR)
    a.add(Calendar.DAY_OF_YEAR, 1)
    val tomorrow = a.get(Calendar.YEAR) == b.get(Calendar.YEAR) && a.get(Calendar.DAY_OF_YEAR) == b.get(Calendar.DAY_OF_YEAR)
    val day = when {
      sameDay -> "Today"
      tomorrow -> "Tomorrow"
      else -> SimpleDateFormat("EEE", Locale.US).format(Date(ms))
    }
    return "$day ${time(ms, clock24)}"
  }

  /** Notification body: "Starts in 10 min · 11:30 – 12:00" */
  fun body(r: Reminder, now: Long = System.currentTimeMillis()): String =
    listOfNotNull(lead(r, now), r.timeText.takeIf { it.isNotBlank() && it != "To-do" }).joinToString(" · ")
}
