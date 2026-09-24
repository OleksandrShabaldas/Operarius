package com.operarius.widgets

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.SpannableStringBuilder
import android.text.SpannableString
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.text.style.StrikethroughSpan
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import java.util.Calendar

/** Today's timeline on the home screen. */
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
      Refresh.ACTION_TICK, Intent.ACTION_TIME_CHANGED, Intent.ACTION_TIMEZONE_CHANGED -> Refresh.all(ctx)
    }
  }

  companion object {
    fun render(ctx: Context, mgr: AppWidgetManager, id: Int) {
      val snap = Snapshot.load(ctx)
      val now = Calendar.getInstance()
      val key = Days.key(now)
      val rv = RemoteViews(ctx.packageName, R.layout.operarius_widget_today)

      rv.setTextViewText(R.id.t_day, Days.WEEKDAYS[now.get(Calendar.DAY_OF_WEEK) - 1])
      rv.setTextViewText(R.id.t_date, "${Days.MONTHS[now.get(Calendar.MONTH)]} ${now.get(Calendar.DAY_OF_MONTH)}")

      val tasks = snap?.days?.get(key).orEmpty()
      val done = tasks.count { it.done }
      rv.setTextViewText(R.id.t_count, if (tasks.isEmpty()) "" else if (done == tasks.size) "All done" else "$done of ${tasks.size}")
      rv.setTextColor(R.id.t_count, if (tasks.isNotEmpty() && done == tasks.size) 0xFF4FD1C5.toInt() else 0xFFC8C8CE.toInt())
      rv.setViewVisibility(R.id.t_bar, if (tasks.isEmpty()) View.GONE else View.VISIBLE)
      rv.setProgressBar(R.id.t_bar, 100, if (tasks.isEmpty()) 0 else done * 100 / tasks.size, false)
      if (snap == null) {
        rv.setTextViewText(R.id.t_empty_title, ctx.getString(R.string.operarius_widget_stale))
        rv.setViewVisibility(R.id.t_empty_sub, View.GONE)
      }

      // The day's all-day tasks on one line (starred first; done ones struck through).
      val allDay = tasks.filter { it.allDay }.sortedByDescending { it.starred }
      rv.setViewVisibility(R.id.t_allday, if (allDay.isEmpty()) View.GONE else View.VISIBLE)
      if (allDay.isNotEmpty()) {
        val line = SpannableStringBuilder()
        allDay.forEachIndexed { i, t ->
          if (i > 0) line.append("  ·  ").also { line.setSpan(ForegroundColorSpan(0xFF5B5B63.toInt()), line.length - 5, line.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) }
          val from = line.length
          line.append(if (t.starred) "★ ${t.title}" else t.title)
          if (t.done) {
            line.setSpan(StrikethroughSpan(), from, line.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            line.setSpan(ForegroundColorSpan(0xFF6E6E76.toInt()), from, line.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
          }
        }
        rv.setTextViewText(R.id.t_allday_txt, line)
        rv.setOnClickPendingIntent(R.id.t_allday, Refresh.open(ctx, "operarius://day?date=$key", 0x7D6))
        if (allDay.size == tasks.size) rv.setTextViewText(R.id.t_empty_title, "Nothing at a set time") // (the day has only all-day tasks)
      }

      // The list (one row per task, "now" and free stretches between).
      val svc = Intent(ctx, TodayWidgetService::class.java).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
      svc.data = Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME))
      @Suppress("DEPRECATION")
      rv.setRemoteAdapter(R.id.t_list, svc)
      rv.setEmptyView(R.id.t_list, R.id.t_empty)
      val template = PendingIntent.getActivity(
        ctx,
        0x7D2,
        Intent(Intent.ACTION_VIEW).setPackage(ctx.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
      )
      rv.setPendingIntentTemplate(R.id.t_list, template)

      rv.setOnClickPendingIntent(R.id.t_add, Refresh.open(ctx, "operarius://new?date=$key", 0x7D3))
      rv.setOnClickPendingIntent(R.id.t_head, Refresh.open(ctx, "operarius://day?date=$key", 0x7D4))
      rv.setOnClickPendingIntent(R.id.t_empty, Refresh.open(ctx, "operarius://new?date=$key", 0x7D5))

      mgr.updateAppWidget(id, rv)
      mgr.notifyAppWidgetViewDataChanged(id, R.id.t_list)

      // Start the list at what's happening now (once its rows have loaded —
      // a scroll sent with the first update lands on an empty list). A list
      // only scrolls a row into view, so aim a screenful past it: "now" then
      // lands near the top, with the row before it for context.
      val rows = TodayRows.build(snap, key, Days.nowMin(now))
      val at = rows.indexOfFirst { it is Row.Now || (it is Row.Task && it.state == Row.NOW) }
      if (at > 1) {
        val o = mgr.getAppWidgetOptions(id)
        val portrait = ctx.resources.configuration.orientation != android.content.res.Configuration.ORIENTATION_LANDSCAPE
        val h = (if (portrait) o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT) else o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT)).takeIf { it > 0 } ?: 250
        val visible = maxOf(2, (h - 78 - (if (allDay.isEmpty()) 0 else 36)) / 52)
        val target = minOf(rows.size - 1, at - 1 + visible - 1)
        if (target >= visible) {
          main.postDelayed({
            try {
              mgr.partiallyUpdateAppWidget(id, RemoteViews(ctx.packageName, R.layout.operarius_widget_today).apply { setScrollPosition(R.id.t_list, target) })
            } catch (_: Exception) {
            }
          }, 700)
        }
      }
    }

    private val main = Handler(Looper.getMainLooper())
  }
}

internal sealed class Row {
  class Task(val t: WTask, val state: Int, val date: String) : Row()
  class Now(val min: Int) : Row()
  class Free(val min: Int, val live: Boolean) : Row()

  companion object {
    const val AHEAD = 0
    const val NOW = 1
    const val PAST = 2
  }
}

/** Today's timeline: the timed tasks in order, with "now" and the free stretches marked (all-day ones sit in the header). */
internal object TodayRows {
  private const val FREE_MIN = 30 // shorter gaps aren't worth a row

  fun build(snap: Snapshot?, key: String, now: Int): List<Row> {
    val tasks = snap?.days?.get(key) ?: return emptyList()
    val out = mutableListOf<Row>()
    val timed = tasks.filter { !it.allDay }.sortedWith(compareBy<WTask>({ it.start }, { it.dur }))
    var placed = false
    var cursor: Int? = null
    for (t in timed) {
      val end = t.start + t.dur
      val c = cursor
      if (c != null && t.start > c) {
        if (!placed && now >= c && now < t.start) {
          out += Row.Now(now)
          placed = true
          if (t.start - now >= FREE_MIN) out += Row.Free(t.start - now, true)
        } else if (t.start - c >= FREE_MIN) out += Row.Free(t.start - c, false)
      }
      if (!placed && now < t.start) {
        out += Row.Now(now)
        placed = true
      }
      val state = when {
        now >= t.start && now < end -> Row.NOW
        end <= now -> Row.PAST
        else -> Row.AHEAD
      }
      if (state == Row.NOW) placed = true
      out += Row.Task(t, state, key)
      cursor = maxOf(c ?: end, end)
    }
    if (!placed && timed.isNotEmpty()) out += Row.Now(now)
    return out
  }
}

class TodayWidgetService : RemoteViewsService() {
  override fun onGetViewFactory(intent: Intent): RemoteViewsFactory = TodayFactory(applicationContext)
}

internal class TodayFactory(private val ctx: Context) : RemoteViewsService.RemoteViewsFactory {
  private var rows: List<Row> = emptyList()
  private var clock24 = true

  override fun onCreate() {}

  override fun onDataSetChanged() {
    val snap = Snapshot.load(ctx)
    clock24 = snap?.clock24 ?: true
    val now = Calendar.getInstance()
    rows = TodayRows.build(snap, Days.key(now), Days.nowMin(now))
  }

  override fun getCount() = rows.size

  override fun getViewAt(position: Int): RemoteViews {
    val row = rows.getOrNull(position) ?: return RemoteViews(ctx.packageName, R.layout.operarius_widget_today_free)
    return when (row) {
      is Row.Task -> task(row)
      is Row.Now -> RemoteViews(ctx.packageName, R.layout.operarius_widget_today_now).apply { setTextViewText(R.id.n_time, Days.time(row.min, clock24)) }
      is Row.Free ->
        RemoteViews(ctx.packageName, R.layout.operarius_widget_today_free).apply {
          setTextViewText(R.id.f_text, if (row.live) "Free · ${Days.dur(row.min)} left" else "Free · ${Days.dur(row.min)}")
          setTextColor(R.id.f_text, if (row.live) 0xFF4FD1C5.toInt() else 0xFF6E6E76.toInt())
        }
    }
  }

  private fun task(row: Row.Task): RemoteViews {
    val t = row.t
    val rv = RemoteViews(ctx.packageName, R.layout.operarius_widget_today_row)
    val grey = t.done || row.state == Row.PAST
    if (t.allDay) {
      rv.setTextViewText(R.id.r_start, "All")
      rv.setTextViewText(R.id.r_end, "day")
    } else {
      rv.setTextViewText(R.id.r_start, Days.time(t.start, clock24))
      rv.setTextViewText(R.id.r_end, Days.time(t.start + t.dur, clock24))
    }
    rv.setTextColor(R.id.r_start, if (row.state == Row.NOW) 0xFFFF5A5F.toInt() else if (grey) 0xFF6E6E76.toInt() else 0xFFC8C8CE.toInt())
    rv.setInt(R.id.r_band, "setColorFilter", if (grey) 0xFF4A4A52.toInt() else t.color)
    rv.setTextViewText(R.id.r_emoji, t.emoji)
    val title = if (t.starred) "★ ${t.title}" else t.title
    rv.setTextViewText(R.id.r_title, if (t.done) SpannableString(title).apply { setSpan(StrikethroughSpan(), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) } else title)
    rv.setTextColor(R.id.r_title, if (grey) 0xFF8A8A92.toInt() else 0xFFF4F4F6.toInt())
    rv.setTextViewText(R.id.r_sub, t.sub)
    rv.setViewVisibility(R.id.r_sub, if (t.sub.isEmpty()) View.GONE else View.VISIBLE)
    rv.setViewVisibility(R.id.r_badge, if (row.state == Row.NOW) View.VISIBLE else View.GONE)
    rv.setInt(R.id.r_root, "setBackgroundResource", if (row.state == Row.NOW) R.drawable.operarius_widget_row_now else 0)
    if (t.done) {
      rv.setImageViewResource(R.id.r_check, R.drawable.operarius_widget_ic_done)
      rv.setInt(R.id.r_check, "setColorFilter", if (row.state == Row.PAST) 0xFF6E6E76.toInt() else t.color)
    } else {
      rv.setImageViewResource(R.id.r_check, R.drawable.operarius_widget_ic_ring)
      rv.setInt(R.id.r_check, "setColorFilter", 0xFF5B5B63.toInt())
    }
    rv.setOnClickFillInIntent(R.id.r_root, Intent().setData(Uri.parse("operarius://task?key=${Uri.encode(t.key)}&date=${row.date}")))
    return rv
  }

  override fun getLoadingView(): RemoteViews? = null

  override fun getViewTypeCount() = 3

  override fun getItemId(position: Int) = position.toLong()

  override fun hasStableIds() = false

  override fun onDestroy() {
    rows = emptyList()
  }
}
