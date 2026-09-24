package com.operarius.widgets

import android.content.Context
import android.graphics.Color
import android.text.SpannableString
import android.text.Spanned
import android.text.style.RelativeSizeSpan
import org.json.JSONObject
import java.util.Calendar
import java.util.Locale

/** One task on a day, as the timeline widget shows it. */
internal class WTask(
  val key: String, // the task (a repeating one's occurrence: "<id>@<day>")
  val title: String,
  val emoji: String,
  val color: Int,
  val allDay: Boolean,
  val start: Int, // minutes from midnight
  val dur: Int,
  val done: Boolean,
  val starred: Boolean,
  val sub: String, // "30 min · Work · Office"
)

/** A task chip in the month grid. */
internal class WChip(val title: String, val color: Int, val done: Boolean)

/** A day in the month grid: how many tasks, and the first few (starred, then all-day, then by time). */
internal class WDay(val total: Int, val chips: List<WChip>)

/**
 * What the app last handed over (modules/widgets/index.ts → update): the
 * tasks of the days around today in full, and the month grid's top tasks for
 * the months around this one. Kept in the app's preferences, so the widgets
 * can draw — and roll over to the next day — without the app running.
 */
internal class Snapshot(
  val clock24: Boolean,
  val mondayFirst: Boolean,
  val days: Map<String, List<WTask>>,
  val month: Map<String, WDay>,
) {
  companion object {
    private const val PREFS = "operarius.widgets"
    private const val KEY = "snapshot"
    private var cached: Pair<String, Snapshot>? = null

    fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun save(ctx: Context, json: String) {
      prefs(ctx).edit().putString(KEY, json).apply()
    }

    fun load(ctx: Context): Snapshot? {
      val raw = prefs(ctx).getString(KEY, null) ?: return null
      cached?.let { if (it.first == raw) return it.second }
      return try {
        parse(JSONObject(raw)).also { cached = raw to it }
      } catch (_: Exception) {
        null
      }
    }

    private fun color(s: String?, fallback: Int = 0xFF5B9DF9.toInt()): Int =
      try {
        if (s.isNullOrEmpty()) fallback else Color.parseColor(s)
      } catch (_: Exception) {
        fallback
      }

    private fun parse(o: JSONObject): Snapshot {
      val days = HashMap<String, List<WTask>>()
      o.optJSONObject("days")?.let { d ->
        for (k in d.keys()) {
          val arr = d.optJSONArray(k) ?: continue
          days[k] = (0 until arr.length()).mapNotNull { i ->
            val t = arr.optJSONObject(i) ?: return@mapNotNull null
            WTask(
              key = t.optString("k"),
              title = t.optString("t"),
              emoji = t.optString("e"),
              color = color(t.optString("c")),
              allDay = t.optInt("a") == 1,
              start = t.optInt("s"),
              dur = t.optInt("d"),
              done = t.optInt("x") == 1,
              starred = t.optInt("st") == 1,
              sub = t.optString("sub"),
            )
          }
        }
      }
      val month = HashMap<String, WDay>()
      o.optJSONObject("month")?.let { m ->
        for (k in m.keys()) {
          val day = m.optJSONObject(k) ?: continue
          val arr = day.optJSONArray("i")
          val chips = if (arr == null) emptyList() else (0 until arr.length()).mapNotNull { i ->
            val c = arr.optJSONObject(i) ?: return@mapNotNull null
            WChip(c.optString("t"), color(c.optString("c")), c.optInt("x") == 1)
          }
          month[k] = WDay(day.optInt("n", chips.size), chips)
        }
      }
      return Snapshot(o.optBoolean("clock24", true), o.optString("weekStart", "mon") != "sun", days, month)
    }
  }
}

/** Days and times the way the app writes them. */
internal object Days {
  val MONTHS = arrayOf("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December")
  val WEEKDAYS = arrayOf("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")

  fun key(c: Calendar): String = String.format(Locale.US, "%04d-%02d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH))

  fun midnight(c: Calendar = Calendar.getInstance()): Calendar =
    (c.clone() as Calendar).apply {
      set(Calendar.HOUR_OF_DAY, 0)
      set(Calendar.MINUTE, 0)
      set(Calendar.SECOND, 0)
      set(Calendar.MILLISECOND, 0)
    }

  fun nowMin(c: Calendar = Calendar.getInstance()) = c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE)

  /** "09:30", or "9:30 AM" with a smaller AM. */
  fun time(min: Int, clock24: Boolean): CharSequence {
    val m = ((min % 1440) + 1440) % 1440
    val h = m / 60
    val mm = m % 60
    if (clock24) return String.format(Locale.US, "%02d:%02d", h, mm)
    val s = String.format(Locale.US, "%d:%02d %s", if (h % 12 == 0) 12 else h % 12, mm, if (h < 12) "AM" else "PM")
    return SpannableString(s).apply { setSpan(RelativeSizeSpan(0.72f), s.length - 3, s.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) }
  }

  /** "45 min" / "1h 30m" / "2 hr" */
  fun dur(d: Int): String = when {
    d < 60 -> "$d min"
    d % 60 == 0 -> "${d / 60} hr"
    else -> "${d / 60}h ${d % 60}m"
  }
}
