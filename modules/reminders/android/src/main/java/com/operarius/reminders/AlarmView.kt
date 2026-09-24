package com.operarius.reminders

import android.animation.Animator
import android.animation.ArgbEvaluator
import android.animation.Keyframe
import android.animation.ObjectAnimator
import android.animation.PropertyValuesHolder
import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Build
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.TextUtils
import android.text.style.RelativeSizeSpan
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.WindowInsets
import android.view.animation.AccelerateDecelerateInterpolator
import android.view.animation.AccelerateInterpolator
import android.view.animation.DecelerateInterpolator
import android.view.animation.OvershootInterpolator
import android.view.animation.PathInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView

/**
 * The reminder screen — shared by the lock-screen activity and the overlay
 * drawn over other apps. Built in code (no layout inflation) so it appears
 * instantly, and animated element by element: the backdrop fades up, the text
 * rises in a stagger, the task's icon springs in and then either breathes
 * (medium) or rings like a bell (intense) inside pulsing sonar rings.
 * Answering plays a small outro (a check for Done, "Snoozed until …") first.
 *
 * Every duration follows the app's animation scale (0 = no animation).
 */
@SuppressLint("ViewConstructor")
internal class AlarmView(
  context: Context,
  private val r: Reminder,
  private val cfg: Config,
  private val overlay: Boolean,
  private val listener: Listener,
) : FrameLayout(context) {

  interface Listener {
    fun onDismiss()
    fun onSnooze()
    fun onDone()
    fun onOpen()
    fun onSilence()
    /** The outro finished — remove / finish the host now. */
    fun onFinished()
  }

  enum class Outro { DISMISS, SNOOZE, DONE, FADE }

  private val color = Palette.parse(r.color)
  private val accent = Palette.accentFor(r)
  private val animOn = cfg.animScale > 0f
  private val compact = resources.displayMetrics.let { it.heightPixels / it.density < 740f }
  private val ease = PathInterpolator(0.16f, 1f, 0.3f, 1f)

  private val glow = GlowView(context, color, accent)
  private val column = LinearLayout(context).apply {
    orientation = LinearLayout.VERTICAL
    gravity = Gravity.CENTER_HORIZONTAL
    clipChildren = false
    clipToPadding = false
  }
  private val badgeIcon = ImageView(context)
  private val badgeText = TextView(context)
  private val badge = LinearLayout(context)
  private val clockTv = TextView(context)
  private val dateTv = TextView(context)
  private val stage = FrameLayout(context).apply { clipChildren = false }
  private val rings = List(3) { RingView(context, color) }
  private val tileBg = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(color, Palette.mix(color, Color.BLACK, 0.3f)))
  private val tile = FrameLayout(context)
  private val emojiTv = TextView(context)
  private val checkIv = ImageView(context)
  private val leadTv = TextView(context)
  private val titleTv = TextView(context)
  private val metaTv = TextView(context)
  private val detailTv = TextView(context)
  private val buttons = LinearLayout(context)
  private val slider = SlideToDismiss(context, if (r.isIntense) "Slide to stop" else "Slide to dismiss", cfg.animScale) { act(Outro.DISMISS) { listener.onDismiss() } }
  private val openRow = LinearLayout(context)

  private val loops = ArrayList<Animator>()
  private var closing = false
  private var introPlayed = false
  private var silencedShown = false
  private val outroCallbacks = ArrayList<() -> Unit>()

  private val tick = object : Runnable {
    override fun run() {
      refreshTime()
      val now = System.currentTimeMillis()
      postDelayed(this, 60_000 - now % 60_000 + 50)
    }
  }

  private fun t(ms: Long): Long = if (animOn) (ms * cfg.animScale).toLong() else 0L
  private fun dp(v: Float) = context.dp(v)
  private fun dpi(v: Float) = context.dpi(v)

  init {
    addView(glow, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    addView(column, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    build()
    isFocusable = true
    isFocusableInTouchMode = true
    setOnApplyWindowInsetsListener { _, insets -> applyInsets(insets); insets }
  }

  // ---- Layout -------------------------------------------------------------------

  private fun text(tv: TextView, sizeSp: Float, color: Int, style: Int = Typeface.NORMAL, family: String = "sans-serif") {
    tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
    tv.setTextColor(color)
    tv.typeface = Typeface.create(family, style)
    tv.includeFontPadding = false
  }

  private fun lp(w: Int = LinearLayout.LayoutParams.WRAP_CONTENT, h: Int = LinearLayout.LayoutParams.WRAP_CONTENT, top: Float = 0f, weight: Float = 0f) =
    LinearLayout.LayoutParams(w, h, weight).apply { topMargin = dpi(top) }

  private fun build() {
    // Badge: 🔔 REMINDER / ALARM (· TEST)
    badge.orientation = LinearLayout.HORIZONTAL
    badge.gravity = Gravity.CENTER_VERTICAL
    badge.setPadding(dpi(11f), dpi(6f), dpi(12f), dpi(6f))
    badge.background = GradientDrawable().apply {
      cornerRadius = dp(14f)
      setColor(Palette.alpha(Color.WHITE, 0.07f))
      setStroke(dpi(1f), Palette.alpha(Color.WHITE, 0.08f))
    }
    badgeIcon.setImageResource(R.drawable.operarius_ic_bell)
    badgeIcon.imageTintList = ColorStateList.valueOf(accent)
    badge.addView(badgeIcon, LinearLayout.LayoutParams(dpi(13f), dpi(13f)))
    text(badgeText, 11f, Palette.TEXT_DIM, Typeface.BOLD, "sans-serif-medium")
    badgeText.letterSpacing = 0.16f
    badgeText.text = badgeLabel()
    badge.addView(badgeText, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { marginStart = dpi(7f) })
    column.addView(badge, lp(top = 14f))

    // Clock + date
    text(clockTv, if (compact) 60f else 74f, Palette.TEXT, Typeface.NORMAL, "sans-serif-light")
    clockTv.letterSpacing = -0.02f
    clockTv.fontFeatureSettings = "tnum"
    column.addView(clockTv, lp(top = if (compact) 10f else 16f))
    text(dateTv, 15f, Palette.alpha(Palette.TEXT_DIM, 0.85f), Typeface.NORMAL, "sans-serif-medium")
    column.addView(dateTv, lp(top = 6f))

    column.addView(View(context), lp(h = 0, weight = 1f))

    // Icon stage: sonar rings behind the task's tile
    val stageSize = dpi(if (compact) 184f else 224f)
    rings.forEach { ring ->
      ring.alpha = 0f
      stage.addView(ring, FrameLayout.LayoutParams(stageSize, stageSize, Gravity.CENTER))
    }
    val tileSize = dpi(if (compact) 100f else 118f)
    tileBg.cornerRadius = tileSize * 0.3f
    tile.background = tileBg
    tile.elevation = dp(20f)
    if (Build.VERSION.SDK_INT >= 28) {
      tile.outlineSpotShadowColor = color
      tile.outlineAmbientShadowColor = color
    }
    val letters = r.emoji.isNotBlank() && r.emoji.all { it.isLetterOrDigit() }
    text(emojiTv, if (letters) (if (compact) 34f else 40f) else (if (compact) 46f else 56f), Palette.BG, if (letters) Typeface.BOLD else Typeface.NORMAL)
    emojiTv.text = r.emoji.ifBlank { "🔔" }
    emojiTv.gravity = Gravity.CENTER
    tile.addView(emojiTv, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
    checkIv.setImageResource(R.drawable.operarius_ic_check)
    checkIv.imageTintList = ColorStateList.valueOf(Palette.BG)
    checkIv.alpha = 0f
    tile.addView(checkIv, FrameLayout.LayoutParams((tileSize * 0.46f).toInt(), (tileSize * 0.46f).toInt(), Gravity.CENTER))
    stage.addView(tile, FrameLayout.LayoutParams(tileSize, tileSize, Gravity.CENTER))
    column.addView(stage, lp(stageSize, stageSize))

    // What / when
    text(leadTv, 12.5f, Palette.mix(accent, Color.WHITE, 0.15f), Typeface.BOLD, "sans-serif-medium")
    leadTv.letterSpacing = 0.16f
    leadTv.gravity = Gravity.CENTER
    column.addView(leadTv, lp(top = if (compact) 10f else 16f))

    text(titleTv, if (compact) 26f else 30f, Palette.TEXT, Typeface.BOLD)
    titleTv.gravity = Gravity.CENTER
    titleTv.maxLines = 3
    titleTv.ellipsize = TextUtils.TruncateAt.END
    titleTv.letterSpacing = -0.01f
    titleTv.setLineSpacing(0f, 1.06f)
    titleTv.text = r.title.ifBlank { "Reminder" }
    column.addView(titleTv, lp(LinearLayout.LayoutParams.MATCH_PARENT, top = 10f))

    text(metaTv, 16f, Palette.TEXT_DIM, Typeface.NORMAL, "sans-serif-medium")
    metaTv.fontFeatureSettings = "tnum"
    metaTv.gravity = Gravity.CENTER
    metaTv.text = metaText()
    metaTv.visibility = if (metaTv.text.isNullOrBlank()) GONE else VISIBLE
    column.addView(metaTv, lp(top = 10f))

    text(detailTv, 13.5f, Palette.MUTED, Typeface.NORMAL, "sans-serif-medium")
    detailTv.gravity = Gravity.CENTER
    detailTv.text = r.detail
    detailTv.visibility = if (r.detail.isBlank()) GONE else VISIBLE
    column.addView(detailTv, lp(top = 6f))

    column.addView(View(context), lp(h = 0, weight = 1.15f))

    // Snooze · Done
    buttons.orientation = LinearLayout.HORIZONTAL
    buttons.addView(glassButton(R.drawable.operarius_ic_clock, "Snooze ${cfg.snoozeMin} min", Palette.TEXT_DIM) { act(Outro.SNOOZE) { listener.onSnooze() } }, LinearLayout.LayoutParams(0, dpi(56f), 1f))
    // A task completes with its subtasks: while any are open, this opens the
    // task to tick them off instead of "Done".
    val finish = if (r.subsLeft > 0) {
      glassButton(R.drawable.operarius_ic_arrow_up_right, if (r.subsLeft == 1) "1 subtask left" else "${r.subsLeft} subtasks left", Palette.ACCENT_A) { listener.onOpen() }
    } else {
      glassButton(R.drawable.operarius_ic_check, "Done", Palette.ACCENT_B) { act(Outro.DONE) { listener.onDone() } }
    }
    buttons.addView(finish, LinearLayout.LayoutParams(0, dpi(56f), 1f).apply { marginStart = dpi(12f) })
    column.addView(buttons, lp(LinearLayout.LayoutParams.MATCH_PARENT))

    column.addView(slider, lp(LinearLayout.LayoutParams.MATCH_PARENT, dpi(if (compact) 62f else 66f), top = 14f))

    // Open the task in the app
    openRow.orientation = LinearLayout.HORIZONTAL
    openRow.gravity = Gravity.CENTER_VERTICAL
    openRow.setPadding(dpi(14f), dpi(10f), dpi(14f), dpi(10f))
    val openTv = TextView(context)
    text(openTv, 14f, Palette.ACCENT_B, Typeface.BOLD, "sans-serif-medium")
    openTv.text = "Open task"
    openRow.addView(openTv)
    val openIc = ImageView(context)
    openIc.setImageResource(R.drawable.operarius_ic_arrow_up_right)
    openIc.imageTintList = ColorStateList.valueOf(Palette.ACCENT_B)
    openRow.addView(openIc, LinearLayout.LayoutParams(dpi(15f), dpi(15f)).apply { marginStart = dpi(5f) })
    openRow.background = RippleDrawable(ColorStateList.valueOf(Palette.alpha(Palette.ACCENT_B, 0.2f)), null, GradientDrawable().apply { cornerRadius = dp(14f); setColor(Color.WHITE) })
    openRow.setOnClickListener { if (!closing) listener.onOpen() }
    pressable(openRow)
    column.addView(openRow, lp(top = 6f))

    refreshTime()
  }

  private fun badgeLabel(): String {
    val base = if (r.isIntense) "ALARM" else "REMINDER"
    return if (r.isTest) "$base · TEST" else base
  }

  private fun metaText(): String {
    val span = if (r.startAt > 0 && r.endAt > r.startAt && r.timeText.contains('–')) " · ${Texts.dur(r.endAt - r.startAt)}" else ""
    return (r.timeText + span).trim()
  }

  private fun glassButton(icon: Int, label: String, tint: Int, onClick: () -> Unit): LinearLayout {
    val b = LinearLayout(context)
    b.orientation = LinearLayout.HORIZONTAL
    b.gravity = Gravity.CENTER
    val shape = GradientDrawable().apply {
      cornerRadius = dp(20f)
      setColor(Palette.alpha(Color.WHITE, 0.07f))
      setStroke(dpi(1f), Palette.alpha(Color.WHITE, 0.1f))
    }
    b.background = RippleDrawable(ColorStateList.valueOf(Palette.alpha(Color.WHITE, 0.16f)), shape, null)
    val iv = ImageView(context)
    iv.setImageResource(icon)
    iv.imageTintList = ColorStateList.valueOf(tint)
    b.addView(iv, LinearLayout.LayoutParams(dpi(18f), dpi(18f)))
    val tv = TextView(context)
    text(tv, 15.5f, Palette.TEXT, Typeface.BOLD, "sans-serif-medium")
    tv.text = label
    tv.maxLines = 1
    b.addView(tv, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { marginStart = dpi(8f) })
    b.setOnClickListener { if (!closing) onClick() }
    pressable(b)
    return b
  }

  @SuppressLint("ClickableViewAccessibility")
  private fun pressable(v: View) {
    v.setOnTouchListener { view, e ->
      when (e.actionMasked) {
        MotionEvent.ACTION_DOWN -> view.animate().scaleX(0.95f).scaleY(0.95f).setDuration(t(90)).setInterpolator(DecelerateInterpolator()).start()
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> view.animate().scaleX(1f).scaleY(1f).setDuration(t(260)).setInterpolator(OvershootInterpolator(2.2f)).start()
      }
      false
    }
  }

  private fun applyInsets(insets: WindowInsets) {
    var top: Int
    var bottom: Int
    if (Build.VERSION.SDK_INT >= 30) {
      val i = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
      top = i.top
      bottom = i.bottom
    } else {
      @Suppress("DEPRECATION")
      top = insets.systemWindowInsetTop
      @Suppress("DEPRECATION")
      bottom = insets.systemWindowInsetBottom
    }
    // An overlay may not get insets on older versions — keep clear of the bars anyway.
    if (top == 0) top = dpi(28f)
    if (bottom == 0) bottom = dpi(16f)
    column.setPadding(dpi(26f), top + dpi(6f), dpi(26f), bottom + dpi(10f))
  }

  private fun refreshTime() {
    val now = System.currentTimeMillis()
    val (hm, ap) = Texts.clock(now, cfg.clock24)
    clockTv.text = if (ap == null) hm else SpannableStringBuilder(hm).apply {
      val s = length
      append(" ").append(ap)
      setSpan(RelativeSizeSpan(0.3f), s, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
    dateTv.text = Texts.date(now)
    if (!closing) leadTv.text = Texts.lead(r, now).uppercase()
  }

  // ---- Motion -------------------------------------------------------------------

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    requestApplyInsets()
    removeCallbacks(tick)
    post(tick)
    if (!introPlayed) {
      introPlayed = true
      intro()
    }
    requestFocus()
  }

  override fun onDetachedFromWindow() {
    removeCallbacks(tick)
    stopLoops()
    super.onDetachedFromWindow()
  }

  private fun rise(v: View, dy: Float, delay: Long, dur: Long = 560) {
    v.alpha = 0f
    v.translationY = dy
    v.animate().alpha(1f).translationY(0f).setStartDelay(t(delay)).setDuration(t(dur)).setInterpolator(ease).start()
  }

  private fun intro() {
    if (!animOn) {
      rings.forEachIndexed { i, ring ->
        ring.alpha = 0.5f - i * 0.15f
        ring.scaleX = 0.62f + i * 0.17f
        ring.scaleY = ring.scaleX
      }
      return
    }
    glow.alpha = 0f
    glow.animate().alpha(1f).setDuration(t(620)).setInterpolator(DecelerateInterpolator()).start()
    rise(badge, -dp(10f), 0)
    rise(clockTv, -dp(16f), 40)
    rise(dateTv, -dp(10f), 90)
    tile.alpha = 0f
    tile.scaleX = 0.4f
    tile.scaleY = 0.4f
    tile.animate().alpha(1f).scaleX(1f).scaleY(1f).setStartDelay(t(120)).setDuration(t(720)).setInterpolator(OvershootInterpolator(1.9f)).start()
    rise(leadTv, dp(18f), 230)
    rise(titleTv, dp(22f), 280)
    rise(metaTv, dp(22f), 330)
    rise(detailTv, dp(22f), 370)
    rise(buttons, dp(28f), 430)
    rise(slider, dp(28f), 480)
    rise(openRow, dp(20f), 540)
    postDelayed({ if (!closing) startLoops() }, t(880))
  }

  private fun startLoops() {
    if (!animOn || closing) return
    val period = if (r.isIntense) 1500L else 2600L
    rings.forEachIndexed { i, ring ->
      ObjectAnimator.ofPropertyValuesHolder(
        ring,
        PropertyValuesHolder.ofFloat(View.SCALE_X, 0.5f, 1f),
        PropertyValuesHolder.ofFloat(View.SCALE_Y, 0.5f, 1f),
        PropertyValuesHolder.ofFloat(View.ALPHA, 0.95f, 0f),
      ).apply {
        duration = t(period)
        repeatCount = ValueAnimator.INFINITE
        startDelay = t(period * i / 3)
        interpolator = DecelerateInterpolator(1.3f)
        start()
        loops += this
      }
    }
    ObjectAnimator.ofPropertyValuesHolder(
      tile,
      PropertyValuesHolder.ofFloat(View.SCALE_X, 1f, 1.045f),
      PropertyValuesHolder.ofFloat(View.SCALE_Y, 1f, 1.045f),
    ).apply {
      duration = t(if (r.isIntense) 700 else 1300)
      repeatCount = ValueAnimator.INFINITE
      repeatMode = ValueAnimator.REVERSE
      interpolator = AccelerateDecelerateInterpolator()
      start()
      loops += this
    }
    if (r.isIntense && !silencedShown) wiggle()
    glow.breathe(t(period))
    slider.startShimmer()
  }

  // Intense: the tile rings like a bell every 1.5 s.
  private var bell: Animator? = null
  private fun wiggle() {
    bell?.cancel()
    val kf = PropertyValuesHolder.ofKeyframe(
      View.ROTATION,
      Keyframe.ofFloat(0f, 0f),
      Keyframe.ofFloat(0.06f, -11f),
      Keyframe.ofFloat(0.12f, 11f),
      Keyframe.ofFloat(0.18f, -8f),
      Keyframe.ofFloat(0.24f, 8f),
      Keyframe.ofFloat(0.30f, -4f),
      Keyframe.ofFloat(0.36f, 0f),
      Keyframe.ofFloat(1f, 0f),
    )
    bell = ObjectAnimator.ofPropertyValuesHolder(tile, kf).apply {
      duration = t(1500)
      repeatCount = ValueAnimator.INFINITE
      start()
    }
  }

  private fun stopLoops() {
    loops.forEach { it.cancel() }
    loops.clear()
    bell?.cancel()
    bell = null
    glow.stop()
  }

  /** Volume key pressed: the alarm went quiet but the reminder stays. */
  fun showSilenced(animated: Boolean = true) {
    if (silencedShown) return
    silencedShown = true
    bell?.cancel()
    bell = null
    if (animated && animOn) tile.animate().rotation(0f).setDuration(t(200)).start() else tile.rotation = 0f
    val swap = {
      badgeIcon.setImageResource(R.drawable.operarius_ic_volume_x)
      badgeIcon.imageTintList = ColorStateList.valueOf(Palette.MUTED)
      badgeText.text = if (r.isTest) "SILENCED · TEST" else "SILENCED"
    }
    if (!animated || !animOn) {
      swap()
      return
    }
    badge.animate().alpha(0f).scaleX(0.9f).scaleY(0.9f).setStartDelay(0).setDuration(t(140)).withEndAction {
      swap()
      badge.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(t(320)).setInterpolator(OvershootInterpolator(2f)).start()
    }.start()
  }

  /** The back gesture: a medium reminder closes; an intense alarm shows how to stop it. */
  fun onBack() {
    if (closing) return
    if (r.isIntense) slider.nudge() else act(Outro.DISMISS) { listener.onDismiss() }
  }

  override fun dispatchKeyEvent(e: KeyEvent): Boolean {
    if (overlay) {
      when (e.keyCode) {
        KeyEvent.KEYCODE_BACK -> {
          if (e.action == KeyEvent.ACTION_UP) onBack()
          return true
        }
        KeyEvent.KEYCODE_VOLUME_UP, KeyEvent.KEYCODE_VOLUME_DOWN -> if (r.isIntense && !silencedShown) {
          if (e.action == KeyEvent.ACTION_UP) listener.onSilence()
          return true
        }
      }
    }
    return super.dispatchKeyEvent(e)
  }

  /** A button / the slider: play its outro first (so a remote close can't pre-empt it), then act. */
  private fun act(kind: Outro, action: () -> Unit) {
    if (closing) return
    performHapticFeedback(if (Build.VERSION.SDK_INT >= 30) android.view.HapticFeedbackConstants.CONFIRM else android.view.HapticFeedbackConstants.VIRTUAL_KEY)
    playOutro(kind) { listener.onFinished() }
    action()
  }

  /**
   * Closes the screen with an outro that says what happened. Safe to call again
   * while one is running — the callback just joins the queue.
   */
  fun playOutro(kind: Outro, then: () -> Unit) {
    outroCallbacks += then
    if (closing) return
    closing = true
    removeCallbacks(tick)
    stopLoops()
    slider.freeze()
    buttons.isEnabled = false
    if (!animOn) {
      finishOutro()
      return
    }
    when (kind) {
      Outro.DONE -> {
        swapLead("MARKED AS DONE")
        emojiTv.animate().alpha(0f).scaleX(0.4f).scaleY(0.4f).setDuration(t(180)).start()
        checkIv.scaleX = 0.3f
        checkIv.scaleY = 0.3f
        checkIv.animate().alpha(1f).scaleX(1f).scaleY(1f).setStartDelay(t(110)).setDuration(t(460)).setInterpolator(OvershootInterpolator(2.6f)).start()
        ValueAnimator.ofObject(ArgbEvaluator(), color, Palette.ACCENT_B).apply {
          duration = t(320)
          addUpdateListener {
            val c = it.animatedValue as Int
            tileBg.colors = intArrayOf(c, Palette.mix(c, Color.BLACK, 0.3f))
          }
          start()
        }
        tile.animate().rotation(0f).scaleX(1.12f).scaleY(1.12f).setDuration(t(200)).setInterpolator(DecelerateInterpolator()).withEndAction {
          tile.animate().scaleX(1f).scaleY(1f).setDuration(t(360)).setInterpolator(OvershootInterpolator(2f)).start()
        }.start()
        burst(Palette.ACCENT_B)
        postDelayed({ fadeAll() }, t(760))
      }
      Outro.SNOOZE -> {
        swapLead("SNOOZED UNTIL " + Texts.time(System.currentTimeMillis() + cfg.snoozeMin * 60_000L, cfg.clock24))
        tile.animate().rotation(-6f).scaleX(0.9f).scaleY(0.9f).alpha(0.85f).setDuration(t(380)).setInterpolator(ease).start()
        postDelayed({ fadeAll() }, t(700))
      }
      Outro.DISMISS, Outro.FADE -> fadeAll()
    }
  }

  private fun swapLead(s: String) {
    leadTv.animate().alpha(0f).translationY(-dp(6f)).setStartDelay(0).setDuration(t(140)).withEndAction {
      leadTv.text = s
      leadTv.setTextColor(Palette.ACCENT_B)
      leadTv.translationY = dp(8f)
      leadTv.animate().alpha(1f).translationY(0f).setDuration(t(320)).setInterpolator(ease).start()
    }.start()
  }

  // One quick ring bursting out of the tile.
  private fun burst(c: Int) {
    val ring = RingView(context, c)
    val size = (stage.width.takeIf { it > 0 } ?: dpi(220f))
    stage.addView(ring, 0, FrameLayout.LayoutParams(size, size, Gravity.CENTER))
    ring.scaleX = 0.45f
    ring.scaleY = 0.45f
    ring.alpha = 1f
    ring.animate().scaleX(1.05f).scaleY(1.05f).alpha(0f).setDuration(t(700)).setInterpolator(DecelerateInterpolator(1.6f)).start()
  }

  private fun fadeAll() {
    column.animate().alpha(0f).translationY(dp(18f)).setStartDelay(0).setDuration(t(260)).setInterpolator(AccelerateInterpolator(1.5f)).start()
    glow.animate().alpha(0f).setStartDelay(t(40)).setDuration(t(320)).setInterpolator(AccelerateInterpolator()).withEndAction { finishOutro() }.start()
  }

  private fun finishOutro() {
    val cbs = outroCallbacks.toList()
    outroCallbacks.clear()
    cbs.forEach { it() }
  }
}
