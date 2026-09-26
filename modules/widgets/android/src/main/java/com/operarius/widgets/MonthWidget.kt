package com.operarius.widgets

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.text.SpannableString
import android.text.Spanned
import android.text.style.StrikethroughSpan
import android.view.View
import android.widget.RemoteViews
import java.util.Calendar
import kotlin.math.floor

/** The month on the home screen: up to three tasks a day, browsable month by month. */
class MonthWidget : AppWidgetProvider() {
  override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
    for (id in ids) render(ctx, mgr, id)
    Refresh.schedule(ctx)
  }

  override fun onAppWidgetOptionsChanged(ctx: Context, mgr: AppWidgetManager, id: Int, opts: Bundle) {
    render(ctx, mgr, id) // resized: as many task lines as now fit
  }

  override fun onDeleted(ctx: Context, ids: IntArray) {
    val e = Snapshot.prefs(ctx).edit()
    for (id in ids) e.remove(MonthView.offsetKey(id))
    e.apply()
  }

  override fun onDisabled(ctx: Context) {
    Refresh.schedule(ctx)
  }

  override fun onReceive(ctx: Context, intent: Intent) {
    super.onReceive(ctx, intent)
    val id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
    if (id == AppWidgetManager.INVALID_APPWIDGET_ID) return
    if (MonthView.step(ctx, id, intent.action)) render(ctx, AppWidgetManager.getInstance(ctx), id)
  }

  companion object {
    fun render(ctx: Context, mgr: AppWidgetManager, id: Int) {
      val rv = RemoteViews(ctx.packageName, R.layout.operarius_widget_month)
      MonthView.fill(ctx, mgr, id, rv, MonthWidget::class.java, 20f, 52f)
      mgr.updateAppWidget(id, rv)
    }
  }
}

/** The month grid and its header — shared by the Month widget and Today & Month. */
internal object MonthView {
  const val ACTION_PREV = "com.operarius.widgets.MONTH_PREV"
  const val ACTION_NEXT = "com.operarius.widgets.MONTH_NEXT"
  const val ACTION_TODAY = "com.operarius.widgets.MONTH_TODAY"
  private const val DARK = 0xFF0B0B0D.toInt()

  fun offsetKey(id: Int) = "month_offset_$id"

  /** Moves widget `id`'s month for a prev / next / back-to-today tap; false for any other action. */
  fun step(ctx: Context, id: Int, action: String?): Boolean {
    val p = Snapshot.prefs(ctx)
    val off = p.getInt(offsetKey(id), 0)
    val next = when (action) {
      ACTION_PREV -> off - 1
      ACTION_NEXT -> off + 1
      ACTION_TODAY -> 0
      else -> return false
    }
    p.edit().putInt(offsetKey(id), next.coerceIn(-24, 24)).apply()
    return true
  }

  private fun action(ctx: Context, cls: Class<*>, id: Int, action: String, code: Int): PendingIntent =
    PendingIntent.getBroadcast(
      ctx,
      id * 8 + code,
      Intent(ctx, cls).setAction(action).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

  // How many task lines fit in a day of this size (and how many when a "+N" line needs room too).
  // `fixed` / `scaled`: the widget's height (dp) around the grid, the latter growing with the font size.
  private fun fit(ctx: Context, mgr: AppWidgetManager, id: Int, rows: Int, fixed: Float, scaled: Float): Pair<Int, Int> {
    val o = mgr.getAppWidgetOptions(id)
    val portrait = ctx.resources.configuration.orientation != Configuration.ORIENTATION_LANDSCAPE
    val h = (if (portrait) o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT) else o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT)).takeIf { it > 0 } ?: 300
    val scale = ctx.resources.configuration.fontScale
    val grid = h - fixed - scaled * scale
    val row = grid / rows - 2f
    val day = 20f
    val chip = 10.2f * scale + 4f // 8.5sp line + padding + gap
    val more = 9.5f * scale + 1f
    val all = floor((row - day) / chip).toInt().coerceIn(0, 3)
    val withMore = floor((row - day - more) / chip).toInt().coerceIn(0, 3)
    return all to withMore
  }

  fun fill(ctx: Context, mgr: AppWidgetManager, id: Int, rv: RemoteViews, cls: Class<*>, fixed: Float, scaled: Float) {
    val snap = Snapshot.load(ctx)
    val mondayFirst = snap?.mondayFirst ?: true
    val off = Snapshot.prefs(ctx).getInt(offsetKey(id), 0)
    val today = Days.midnight()
    val todayKey = Days.key(today)
    val first = (today.clone() as Calendar).apply {
      set(Calendar.DAY_OF_MONTH, 1)
      add(Calendar.MONTH, off)
    }
    val month = first.get(Calendar.MONTH)
    val lead = if (mondayFirst) (first.get(Calendar.DAY_OF_WEEK) + 5) % 7 else first.get(Calendar.DAY_OF_WEEK) - 1
    val rows = (lead + first.getActualMaximum(Calendar.DAY_OF_MONTH) + 6) / 7
    val (fitAll, fitMore) = fit(ctx, mgr, id, rows, fixed, scaled)

    // Header: the month, its year, back to this month, and the arrows.
    rv.setTextViewText(R.id.m_month, Days.MONTHS[month])
    rv.setTextViewText(R.id.m_year, first.get(Calendar.YEAR).toString())
    rv.setViewVisibility(R.id.m_today, if (off != 0) View.VISIBLE else View.GONE)
    rv.setOnClickPendingIntent(R.id.m_today, action(ctx, cls, id, ACTION_TODAY, 0))
    rv.setOnClickPendingIntent(R.id.m_prev, action(ctx, cls, id, ACTION_PREV, 1))
    rv.setOnClickPendingIntent(R.id.m_next, action(ctx, cls, id, ACTION_NEXT, 2))
    rv.setOnClickPendingIntent(R.id.m_title, if (off != 0) action(ctx, cls, id, ACTION_TODAY, 3) else Refresh.open(ctx, "operarius://day?date=$todayKey", id * 64 + 63))

    // Weekday letters (today's column lit while this month is shown).
    val letters = if (mondayFirst) "MTWTFSS" else "SMTWTFS"
    val todayCol = if (mondayFirst) (today.get(Calendar.DAY_OF_WEEK) + 5) % 7 else today.get(Calendar.DAY_OF_WEEK) - 1
    for (c in 0 until 7) {
      rv.setTextViewText(MonthIds.weekdays[c], letters[c].toString())
      rv.setTextColor(MonthIds.weekdays[c], if (off == 0 && c == todayCol) 0xFF4FD1C5.toInt() else 0xFF6E6E76.toInt())
    }
    for (r in 0 until 6) rv.setViewVisibility(MonthIds.rows[r], if (r < rows) View.VISIBLE else View.GONE)

    val cur = (first.clone() as Calendar).apply { add(Calendar.DAY_OF_MONTH, -lead) }
    val chipIds = arrayOf(MonthIds.chip1, MonthIds.chip2, MonthIds.chip3)
    for (i in 0 until rows * 7) {
      val key = Days.key(cur)
      val inMonth = cur.get(Calendar.MONTH) == month
      val isToday = key == todayKey
      val past = key < todayKey

      rv.setTextViewText(MonthIds.days[i], cur.get(Calendar.DAY_OF_MONTH).toString())
      rv.setTextColor(
        MonthIds.days[i],
        when {
          isToday -> DARK
          !inMonth -> 0xFF3E3E45.toInt()
          past -> 0xFF7A7A82.toInt()
          else -> 0xFFE4E4E8.toInt()
        },
      )
      rv.setInt(MonthIds.days[i], "setBackgroundResource", if (isToday) R.drawable.operarius_widget_today_dot else 0)
      rv.setInt(MonthIds.cells[i], "setBackgroundResource", if (isToday) R.drawable.operarius_widget_cell_today else 0)

      val d = snap?.month?.get(key)
      val total = d?.total ?: 0
      val chips = d?.chips.orEmpty()
      val shown = if (total > fitAll) minOf(fitMore, chips.size) else minOf(fitAll, chips.size)
      for (k in 0 until 3) {
        val cid = chipIds[k][i]
        if (k >= shown) {
          rv.setViewVisibility(cid, View.GONE)
          continue
        }
        val chip = chips[k]
        rv.setViewVisibility(cid, View.VISIBLE)
        rv.setTextViewText(cid, if (chip.done) SpannableString(chip.title).apply { setSpan(StrikethroughSpan(), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) } else chip.title)
        val strong = inMonth && !chip.done && !past
        rv.setTextColor(cid, if (strong) 0xFFF4F4F6.toInt() else 0xFF9A9AA2.toInt())
        val tint = (chip.color and 0x00FFFFFF) or ((if (strong) 0x70 else if (inMonth) 0x38 else 0x22) shl 24)
        if (Build.VERSION.SDK_INT >= 31) rv.setColorStateList(cid, "setBackgroundTintList", ColorStateList.valueOf(tint))
        else rv.setInt(cid, "setBackgroundColor", tint)
      }
      val rest = total - shown
      rv.setViewVisibility(MonthIds.more[i], if (rest > 0) View.VISIBLE else View.GONE)
      if (rest > 0) rv.setTextViewText(MonthIds.more[i], if (shown == 0) "$rest" else "+$rest")

      rv.setOnClickPendingIntent(MonthIds.cells[i], Refresh.open(ctx, "operarius://day?date=$key", id * 64 + i))
      cur.add(Calendar.DAY_OF_MONTH, 1)
    }
  }
}
