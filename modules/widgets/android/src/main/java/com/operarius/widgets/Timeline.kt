package com.operarius.widgets

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.text.SpannableString
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.text.style.StrikethroughSpan
import android.text.style.StyleSpan
import android.util.TypedValue
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import java.util.Calendar

/** One row of the timeline list. */
internal sealed class TRow {
  /** The now line (unless the task on now draws it across itself). */
  object Now : TRow()

  /** A task; `line` = how far through it the moment is (0–1) when the now line crosses it. */
  class Card(val t: WTask, val line: Float?, val running: Boolean) : TRow()

  /**
   * The time between two things on the line, [from, to): free time (a hatched block
   * to tap and fill), a short gap (a chip), or none (the rail joining two tasks back
   * to back). The rail's halves take the colours of the tasks above and below (null:
   * nothing there). `live` = it starts at the now line; `inside` = within the day.
   */
  class Gap(val from: Int, val to: Int, val kind: Int, val live: Boolean, val inside: Boolean, val bounded: Boolean, val above: Int?, val below: Int?) : TRow()

  /** Two tasks at the same time. */
  class Overlap(val min: Int, val full: Boolean) : TRow()

  /** The day's start or end (Settings → General). */
  class Edge(val end: Boolean, val min: Int) : TRow()

  /** Nothing more today: how the day went. */
  class Note(val title: String, val sub: String, val allDone: Boolean) : TRow()

  /** Tomorrow's first task. */
  class Next(val t: WTask, val more: Int) : TRow()

  companion object {
    const val RAIL = 0
    const val CHIP = 1
    const val FREE = 2
  }
}

/**
 * What's left of today as a timeline, the app's way: from the now line on — tasks
 * that are over aren't shown — with free time, short gaps, overlaps and the day's
 * start and end between the tasks, and tomorrow's first task at the end.
 * (src/widgets.ts `widgetTimeline` builds the same rows for the app's preview.)
 */
internal object Timeline {
  const val STALE = "Open Operarius to load your tasks"

  fun rows(snap: Snapshot?, today: String, tomorrow: String, now: Int, lineInCards: Boolean): List<TRow> {
    val out = ArrayList<TRow>()
    if (snap == null) {
      out += TRow.Now
      out += TRow.Note(STALE, "Your day will show up here", false)
      return out
    }
    val day = snap.days[today].orEmpty()
    val ahead = day.filter { !it.allDay && it.start + it.dur > now }.sortedWith(compareBy<WTask>({ it.start }, { -it.dur }, { it.key }))
    val ds = snap.dayStart
    val de = snap.dayEnd
    val window = ds < de
    // The day's start and end still to come, in order.
    val edges = ArrayList<TRow.Edge>()
    if (window && ds > now) edges += TRow.Edge(false, ds)
    if (window && de > now) edges += TRow.Edge(true, de)

    val first = ahead.firstOrNull()
    if (!(lineInCards && first != null && first.start <= now)) out += TRow.Now
    var cursor = now // the line is drawn up to here
    var above: Int? = null // the rail colour of the task right above (null: the now line or an edge)
    var fresh = true // nothing since the now line
    var prev: WTask? = null

    fun gap(to: Int, below: Int?, bounded: Boolean) {
      val len = to - cursor
      if (len < 0) return
      if (len == 0) {
        val a = above
        if (a != null && below != null) out += TRow.Gap(cursor, to, TRow.RAIL, false, true, bounded, a, below)
        return
      }
      val inside = !window || (cursor >= ds && to <= de)
      out += TRow.Gap(cursor, to, if (inside && len > snap.gap) TRow.FREE else TRow.CHIP, fresh, inside, bounded, above, below)
    }

    fun edgesUpTo(t: Int) {
      while (edges.isNotEmpty() && edges[0].min <= t) {
        val e = edges.removeAt(0)
        gap(e.min, null, false)
        out += e
        cursor = maxOf(cursor, e.min)
        above = null
        fresh = false
      }
    }

    for (t in ahead) {
      val s = t.start
      val e = s + t.dur
      if (prev != null && s < cursor) {
        // At the same time as what's above: fused to it by an overlap, like in the app.
        out += TRow.Overlap(minOf(cursor, e) - s, e <= cursor)
      } else {
        edgesUpTo(s)
        gap(s, railColor(t), true)
      }
      val running = s <= now
      out += TRow.Card(t, if (lineInCards && prev == null && running) (now - s).toFloat() / maxOf(1, t.dur) else null, running)
      cursor = maxOf(cursor, e)
      above = railColor(t)
      fresh = false
      prev = t
    }
    edgesUpTo(Int.MAX_VALUE)

    // Nothing more today and the day is over: a word about it.
    if (ahead.isEmpty() && !(window && de > now)) out += note(day)

    // Tomorrow's first task (its first at a set time, else its first all-day one).
    val next = snap.days[tomorrow].orEmpty()
    val lead = next.filter { !it.allDay }.minWithOrNull(compareBy<WTask>({ it.start }, { -it.dur })) ?: next.sortedByDescending { it.starred }.firstOrNull()
    if (lead != null) out += TRow.Next(lead, next.size - 1)
    return out
  }

  fun railColor(t: WTask): Int = if (t.done) GREY else t.color

  /** A colour without its colour (same lightness): what's behind the now line, as the app shows it. */
  fun grey(c: Int): Int {
    val l = (0.299 * Color.red(c) + 0.587 * Color.green(c) + 0.114 * Color.blue(c)).toInt().coerceIn(0, 255)
    return Color.rgb(l, l, l)
  }

  private fun note(day: List<WTask>): TRow.Note {
    val open = day.count { !it.done }
    return when {
      day.isEmpty() -> TRow.Note("Nothing planned today", "Tap + to add a task", false)
      open == 0 -> TRow.Note("All done for today", if (day.size == 1) "Your task is checked off" else "All ${day.size} tasks checked off", true)
      else -> TRow.Note("That's all for today", if (open == 1) "1 task still unchecked" else "$open tasks still unchecked", false)
    }
  }

  const val TEXT = 0xFFF4F4F6.toInt()
  const val DIM = 0xFFC8C8CE.toInt()
  const val MUTED = 0xFF8A8A92.toInt()
  const val FAINT = 0xFF5B5B63.toInt()
  const val NOW = 0xFFFF5A5F.toInt()
  const val TEAL = 0xFF4FD1C5.toInt()
  const val STAR = 0xFFF2C14E.toInt()
  const val GREY = 0xFF4A4A52.toInt()
  const val STRUCK = 0xFF6A6A72.toInt()
}

/** Today's header and body — shared by the Today widget and Today & Month. */
internal object TodayView {
  fun fill(ctx: Context, id: Int, rv: RemoteViews) {
    val snap = Snapshot.load(ctx)
    val now = Calendar.getInstance()
    val key = Days.key(now)

    rv.setTextViewText(R.id.t_day, Days.WEEKDAYS[now.get(Calendar.DAY_OF_WEEK) - 1])
    rv.setTextViewText(R.id.t_date, "${Days.MONTHS[now.get(Calendar.MONTH)]} ${now.get(Calendar.DAY_OF_MONTH)}")

    val tasks = snap?.days?.get(key).orEmpty()
    val done = tasks.count { it.done }
    rv.setTextViewText(R.id.t_count, if (tasks.isEmpty()) "" else if (done == tasks.size) "All done" else "$done of ${tasks.size}")
    rv.setTextColor(R.id.t_count, if (tasks.isNotEmpty() && done == tasks.size) Timeline.TEAL else Timeline.DIM)
    rv.setViewVisibility(R.id.t_count, if (tasks.isEmpty()) View.GONE else View.VISIBLE)
    rv.setViewVisibility(R.id.t_bar, if (tasks.isEmpty()) View.INVISIBLE else View.VISIBLE)
    rv.setProgressBar(R.id.t_bar, 100, if (tasks.isEmpty()) 0 else done * 100 / tasks.size, false)

    // The day's all-day tasks on one line (starred first; done ones struck through).
    val allDay = tasks.filter { it.allDay }.sortedByDescending { it.starred }
    rv.setViewVisibility(R.id.t_allday, if (allDay.isEmpty()) View.GONE else View.VISIBLE)
    if (allDay.isNotEmpty()) {
      val line = SpannableStringBuilder()
      allDay.forEachIndexed { i, t ->
        if (i > 0) line.append("  ·  ").also { line.setSpan(ForegroundColorSpan(Timeline.FAINT), line.length - 5, line.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) }
        val from = line.length
        line.append(if (t.starred) "★ ${t.title}" else t.title)
        if (t.done) {
          line.setSpan(StrikethroughSpan(), from, line.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
          line.setSpan(ForegroundColorSpan(0xFF6E6E76.toInt()), from, line.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
      }
      rv.setTextViewText(R.id.t_allday_txt, line)
      rv.setOnClickPendingIntent(R.id.t_allday, Refresh.open(ctx, "operarius://day?date=$key", 0x7D6))
    }

    // The timeline (rows from TimelineFactory); while they load, the now line alone.
    val svc = Intent(ctx, TodayWidgetService::class.java).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
    svc.data = Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME))
    @Suppress("DEPRECATION")
    rv.setRemoteAdapter(R.id.t_list, svc)
    rv.setEmptyView(R.id.t_list, R.id.t_empty)
    clock(rv, R.id.t_e_clock, snap?.clock24 ?: true)
    val template = PendingIntent.getActivity(
      ctx,
      0x7D2,
      Intent(Intent.ACTION_VIEW).setPackage(ctx.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
    )
    rv.setPendingIntentTemplate(R.id.t_list, template)

    rv.setOnClickPendingIntent(R.id.t_add, Refresh.open(ctx, "operarius://new?date=$key", 0x7D3))
    rv.setOnClickPendingIntent(R.id.t_head, Refresh.open(ctx, "operarius://day?date=$key", 0x7D4))
    rv.setOnClickPendingIntent(R.id.t_empty, Refresh.open(ctx, "operarius://day?date=$key", 0x7D5))
  }

  /** The now line's time follows the app's clock setting, not the phone's. */
  fun clock(rv: RemoteViews, id: Int, clock24: Boolean) {
    val f = if (clock24) "HH:mm" else "h:mm"
    rv.setCharSequence(id, "setFormat24Hour", f)
    rv.setCharSequence(id, "setFormat12Hour", f)
  }
}

class TodayWidgetService : RemoteViewsService() {
  override fun onGetViewFactory(intent: Intent): RemoteViewsFactory = TimelineFactory(applicationContext)
}

/** Draws the timeline's rows. */
internal class TimelineFactory(private val ctx: Context) : RemoteViewsService.RemoteViewsFactory {
  private var rows: List<TRow> = emptyList()
  private var clock24 = true
  private var today = ""
  private var tomorrow = ""
  private var now = 0
  private val pkg = ctx.packageName

  override fun onCreate() {}

  override fun onDataSetChanged() {
    val snap = Snapshot.load(ctx)
    clock24 = snap?.clock24 ?: true
    val c = Calendar.getInstance()
    today = Days.key(c)
    tomorrow = Days.tomorrow(c)
    now = Days.nowMin(c)
    rows = Timeline.rows(snap, today, tomorrow, now, Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
  }

  override fun getCount() = rows.size

  override fun getViewAt(position: Int): RemoteViews =
    when (val row = rows.getOrNull(position)) {
      null -> blank()
      is TRow.Now -> RemoteViews(pkg, R.layout.operarius_widget_tl_now).apply {
        TodayView.clock(this, R.id.n_clock, clock24)
        setOnClickFillInIntent(R.id.r_root, link("operarius://day?date=$today"))
      }
      is TRow.Card -> card(row)
      is TRow.Gap -> gap(row)
      is TRow.Overlap -> RemoteViews(pkg, R.layout.operarius_widget_tl_overlap).apply {
        setTextViewText(R.id.o_text, "${if (row.full) "Fully overlapping" else "Overlapping"} · ${Days.dur(row.min)}")
        setOnClickFillInIntent(R.id.r_root, link("operarius://day?date=$today"))
      }
      is TRow.Edge -> RemoteViews(pkg, R.layout.operarius_widget_tl_edge).apply {
        setTextViewText(R.id.e_text, SpannableStringBuilder(if (row.end) "END OF DAY · " else "BEGINNING OF DAY · ").append(Days.time(row.min, clock24)))
        setOnClickFillInIntent(R.id.r_root, link("operarius://day?date=$today"))
      }
      is TRow.Note -> RemoteViews(pkg, R.layout.operarius_widget_tl_note).apply {
        setTextViewText(R.id.n_title, row.title)
        setTextColor(R.id.n_title, if (row.allDone) Timeline.TEAL else Timeline.DIM)
        setTextViewText(R.id.n_sub, row.sub)
        setViewVisibility(R.id.n_icon, if (row.allDone) View.VISIBLE else View.GONE)
        setOnClickFillInIntent(R.id.r_root, link("operarius://day?date=$today"))
      }
      is TRow.Next -> next(row)
    }

  private fun card(row: TRow.Card): RemoteViews {
    val t = row.t
    val meta = t.tag.isNotEmpty() || t.place.isNotEmpty() || t.subs.isNotEmpty()
    val rv = RemoteViews(pkg, if (meta) R.layout.operarius_widget_tl_card_meta else R.layout.operarius_widget_tl_card)
    val done = t.done

    rv.setTextViewText(R.id.r_start, Days.gutter(t.start, clock24))
    rv.setTextColor(R.id.r_start, if (row.running && row.line == null) Timeline.NOW else if (done) Timeline.FAINT else Timeline.MUTED)
    rv.setViewVisibility(R.id.r_start, View.VISIBLE)
    rv.setInt(R.id.r_band, "setColorFilter", Timeline.railColor(t))
    rv.setTextViewText(R.id.r_emoji, t.emoji)

    val title = SpannableStringBuilder()
    if (t.starred) title.append("★ ").also { title.setSpan(ForegroundColorSpan(if (done) Timeline.STRUCK else Timeline.STAR), 0, 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) }
    val from = title.length
    title.append(t.title)
    if (done) title.setSpan(StrikethroughSpan(), from, title.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    rv.setTextViewText(R.id.r_title, title)
    rv.setTextColor(R.id.r_title, if (done) Timeline.STRUCK else Timeline.TEXT)

    // "09:30 – 11:00 · 1h 30m", the length fainter.
    val time = SpannableStringBuilder().append(Days.time(t.start, clock24)).append(" – ").append(Days.time(t.start + t.dur, clock24))
    val at = time.length
    time.append(" · ${Days.dur(t.dur)}")
    time.setSpan(ForegroundColorSpan(Timeline.FAINT), at, time.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    rv.setTextViewText(R.id.r_time, time)

    if (meta) {
      rv.setViewVisibility(R.id.r_tag, if (t.tag.isEmpty()) View.GONE else View.VISIBLE)
      if (t.tag.isNotEmpty()) {
        val c = if (done) Timeline.MUTED else t.tagColor ?: Timeline.MUTED
        rv.setTextViewText(R.id.r_tag, t.tag)
        rv.setTextColor(R.id.r_tag, c)
        val bg = (c and 0x00FFFFFF) or (0x26 shl 24)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) rv.setColorStateList(R.id.r_tag, "setBackgroundTintList", ColorStateList.valueOf(bg))
        else rv.setInt(R.id.r_tag, "setBackgroundColor", bg)
      }
      rv.setViewVisibility(R.id.r_place, if (t.place.isEmpty()) View.GONE else View.VISIBLE)
      rv.setTextViewText(R.id.r_place, t.place)
      rv.setTextViewText(R.id.r_subs, if (t.subs.isEmpty()) "" else "${t.subs} subtasks")
    }

    if (done) {
      rv.setImageViewResource(R.id.r_check, R.drawable.operarius_widget_ic_disc)
      rv.setInt(R.id.r_check, "setColorFilter", t.color)
      rv.setViewVisibility(R.id.r_tick, View.VISIBLE)
    } else {
      rv.setImageViewResource(R.id.r_check, R.drawable.operarius_widget_ic_ring)
      rv.setInt(R.id.r_check, "setColorFilter", Timeline.FAINT)
      rv.setViewVisibility(R.id.r_tick, View.GONE)
    }

    // Android 12+: the now line across the task that's on, the part behind it dimmed.
    // (Rows are recycled, so every card sets these, on or off.)
    val line = row.line
    if (line != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val h = if (meta) 72f else 56f
      val y = (line * h).coerceIn(4f, h - 4f)
      rv.setViewVisibility(R.id.r_elapsed, View.VISIBLE)
      rv.setViewLayoutHeight(R.id.r_elapsed, y, TypedValue.COMPLEX_UNIT_DIP)
      rv.setViewVisibility(R.id.r_bandpast, View.VISIBLE)
      rv.setViewLayoutHeight(R.id.r_bandpast, y, TypedValue.COMPLEX_UNIT_DIP)
      rv.setInt(R.id.r_bandpast, "setColorFilter", Timeline.grey(Timeline.railColor(t)))
      rv.setViewVisibility(R.id.r_nowline, View.VISIBLE)
      rv.setViewLayoutMargin(R.id.r_nowline, RemoteViews.MARGIN_TOP, y - 9f, TypedValue.COMPLEX_UNIT_DIP)
      TodayView.clock(rv, R.id.r_clock, clock24)
      // The start time steps aside while the now line's time would touch it
      // (it's taller in 12-hour time: "9:30" over "AM").
      if (y < if (clock24) 28f else 40f) rv.setViewVisibility(R.id.r_start, View.INVISIBLE)
    } else {
      rv.setViewVisibility(R.id.r_elapsed, View.GONE)
      rv.setViewVisibility(R.id.r_bandpast, View.GONE)
      rv.setViewVisibility(R.id.r_nowline, View.GONE)
    }
    rv.setOnClickFillInIntent(R.id.r_root, link("operarius://task?key=${Uri.encode(t.key)}&date=$today"))
    return rv
  }

  private fun gap(g: TRow.Gap): RemoteViews {
    val rv = RemoteViews(
      pkg,
      when (g.kind) {
        TRow.RAIL -> R.layout.operarius_widget_tl_rail
        TRow.CHIP -> R.layout.operarius_widget_tl_chip
        else -> R.layout.operarius_widget_tl_free
      },
    )
    rail(rv, R.id.g_top, g.above)
    rail(rv, R.id.g_bot, g.below)
    if (g.kind == TRow.RAIL) return rv

    val len = g.to - g.from
    val label: CharSequence = when {
      // Free from now on: until when (a countdown would be out of date between redraws).
      g.live && g.inside -> SpannableString(SpannableStringBuilder("Free until ").append(Days.time(g.to, clock24))).apply { setSpan(StyleSpan(Typeface.BOLD), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) }
      g.kind == TRow.FREE -> "${Days.dur(len)} free"
      g.inside -> "$len min"
      else -> Days.dur(len)
    }
    val color = if (g.live && g.inside) Timeline.NOW else if (g.kind == TRow.FREE) Timeline.FAINT else Timeline.MUTED
    if (g.kind == TRow.CHIP) {
      rv.setTextViewText(R.id.c_text, label)
      rv.setTextColor(R.id.c_text, color)
    } else {
      rv.setTextViewText(R.id.f_label, label)
      rv.setTextColor(R.id.f_label, color)
    }
    // Tap to plan something there (from now on, when it's the time right ahead).
    val start = if (g.live) minOf(maxOf(g.from, (now + 2) / 5 * 5), g.to - 5).coerceAtLeast(g.from) else g.from
    val dur = if (g.bounded) maxOf(5, g.to - start) else 30
    rv.setOnClickFillInIntent(R.id.r_root, link("operarius://new?date=$today&start=$start&dur=$dur"))
    return rv
  }

  /** A half of the dotted rail: in the task's colour, or faint where no task is. */
  private fun rail(rv: RemoteViews, id: Int, color: Int?) {
    rv.setInt(id, "setColorFilter", color ?: 0xFFFFFFFF.toInt())
    rv.setInt(id, "setImageAlpha", if (color == null) 41 else 158)
  }

  private fun next(row: TRow.Next): RemoteViews {
    val t = row.t
    val rv = RemoteViews(pkg, R.layout.operarius_widget_tl_next)
    rv.setInt(R.id.x_tile, "setColorFilter", t.color)
    rv.setInt(R.id.x_tile, "setImageAlpha", 84)
    rv.setTextViewText(R.id.x_emoji, t.emoji)
    rv.setTextViewText(R.id.x_gut, if (t.allDay) "" else Days.gutter(t.start, clock24))
    rv.setTextViewText(R.id.x_when, if (t.allDay) "TOMORROW · ALL DAY" else "TOMORROW")
    rv.setTextViewText(R.id.x_title, if (t.starred) "★ ${t.title}" else t.title)
    rv.setViewVisibility(R.id.x_more, if (row.more > 0) View.VISIBLE else View.GONE)
    rv.setTextViewText(R.id.x_more, "+${row.more}")
    rv.setOnClickFillInIntent(R.id.r_root, link("operarius://task?key=${Uri.encode(t.key)}&date=$tomorrow"))
    return rv
  }

  private fun link(uri: String) = Intent().setData(Uri.parse(uri))

  // Blank while a row loads (not the default "Loading…").
  private fun blank() = RemoteViews(pkg, R.layout.operarius_widget_tl_loading)

  override fun getLoadingView(): RemoteViews = blank()

  // now, card, card with tag/place, rail, chip, free, overlap, edge, note,
  // tomorrow — and the blank row (for a row asked for while the list shrinks),
  // plus one: the list counts its loading row as a type of its own.
  override fun getViewTypeCount() = 12

  override fun getItemId(position: Int) = position.toLong()

  override fun hasStableIds() = false

  override fun onDestroy() {
    rows = emptyList()
  }
}
