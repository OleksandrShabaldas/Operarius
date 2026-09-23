package com.operarius.reminders

import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.os.Build
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.accessibility.AccessibilityNodeInfo
import android.view.animation.DecelerateInterpolator
import android.view.animation.LinearInterpolator
import android.view.animation.OvershootInterpolator
import androidx.core.content.ContextCompat
import kotlin.math.max
import kotlin.math.min

/** The screen's backdrop: near-black with the task's colour glowing behind the icon, breathing slowly. */
@SuppressLint("ViewConstructor")
internal class GlowView(ctx: Context, private val color: Int, private val accent: Int) : View(ctx) {
  private val base = Paint().apply { color = Palette.BG }
  private val main = Paint(Paint.ANTI_ALIAS_FLAG)
  private val low = Paint(Paint.ANTI_ALIAS_FLAG)
  private val corner = Paint(Paint.ANTI_ALIAS_FLAG)
  private var level = 1f
  private var anim: ValueAnimator? = null

  override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) {
    val fw = w.toFloat()
    val fh = h.toFloat()
    main.shader = RadialGradient(
      fw * 0.5f, fh * 0.37f, max(fw, fh) * 0.62f,
      intArrayOf(Palette.alpha(color, 0.4f), Palette.alpha(color, 0.12f), Palette.alpha(color, 0f)),
      floatArrayOf(0f, 0.45f, 1f), Shader.TileMode.CLAMP
    )
    low.shader = RadialGradient(fw * 0.08f, fh * 1.02f, fw * 0.95f, Palette.alpha(Palette.ACCENT_A, 0.22f), Palette.alpha(Palette.ACCENT_A, 0f), Shader.TileMode.CLAMP)
    corner.shader = RadialGradient(fw * 0.96f, fh * 0.02f, fw * 0.75f, Palette.alpha(accent, 0.16f), Palette.alpha(accent, 0f), Shader.TileMode.CLAMP)
  }

  override fun onDraw(c: Canvas) {
    val w = width.toFloat()
    val h = height.toFloat()
    c.drawRect(0f, 0f, w, h, base)
    main.alpha = (255 * level).toInt()
    c.drawRect(0f, 0f, w, h, main)
    c.drawRect(0f, 0f, w, h, low)
    corner.alpha = (255 * (0.55f + 0.45f * level)).toInt()
    c.drawRect(0f, 0f, w, h, corner)
  }

  fun breathe(periodMs: Long) {
    anim?.cancel()
    if (periodMs <= 0) return
    anim = ValueAnimator.ofFloat(1f, 0.7f).apply {
      duration = periodMs
      repeatCount = ValueAnimator.INFINITE
      repeatMode = ValueAnimator.REVERSE
      addUpdateListener {
        level = it.animatedValue as Float
        invalidate()
      }
      start()
    }
  }

  fun stop() {
    anim?.cancel()
    anim = null
  }

  override fun onDetachedFromWindow() {
    stop()
    super.onDetachedFromWindow()
  }
}

/** One "sonar" ring around the icon (scaled / faded by its owner). */
@SuppressLint("ViewConstructor")
internal class RingView(ctx: Context, color: Int) : View(ctx) {
  private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = Palette.alpha(color, 0.13f) }
  private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeWidth = ctx.dp(1.5f)
    this.color = Palette.alpha(color, 0.55f)
  }

  override fun onDraw(c: Canvas) {
    val r = min(width, height) / 2f - stroke.strokeWidth
    c.drawCircle(width / 2f, height / 2f, r, fill)
    c.drawCircle(width / 2f, height / 2f, r, stroke)
  }
}

/**
 * "Slide to dismiss": a pill track with a gradient thumb. Drag it to the end to
 * confirm (a pocket can't dismiss an alarm); let go early and it springs back.
 * The label shimmers to invite the gesture; tapping the track gives a hint nudge.
 */
@SuppressLint("ViewConstructor")
internal class SlideToDismiss(
  ctx: Context,
  private val label: String,
  private val animScale: Float,
  private val onComplete: () -> Unit,
) : View(ctx) {
  private val track = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Palette.alpha(0xFFFFFFFF.toInt(), 0.07f) }
  private val trackStroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeWidth = ctx.dp(1f)
    color = Palette.alpha(0xFFFFFFFF.toInt(), 0.1f)
  }
  private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
  private val thumb = Paint(Paint.ANTI_ALIAS_FLAG)
  private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    textSize = ctx.dp(15.5f)
    typeface = Typeface.create("sans-serif-medium", Typeface.BOLD)
    textAlign = Paint.Align.CENTER
    letterSpacing = 0.02f
  }
  private val icon = ContextCompat.getDrawable(ctx, R.drawable.operarius_ic_chevrons_right)?.mutate()?.apply { setTint(Palette.BG) }
  private val rect = RectF()

  private var progress = 0f
  private var dragging = false
  private var downX = 0f
  private var downProgress = 0f
  private var done = false
  private var shimmer = 0f
  private var shimmerAnim: ValueAnimator? = null
  private var settle: ValueAnimator? = null
  private var ticked = false

  init {
    isClickable = true
    isFocusable = true
    contentDescription = label
  }

  private fun t(ms: Long) = if (animScale > 0f) (ms * animScale).toLong() else 0L
  private val pad get() = context.dp(6f)
  private val thumbD get() = height - 2 * pad
  private val travel get() = max(1f, width - 2 * pad - thumbD)

  fun startShimmer() {
    if (animScale <= 0f || shimmerAnim != null) return
    shimmerAnim = ValueAnimator.ofFloat(-0.4f, 1.4f).apply {
      duration = t(2300)
      repeatCount = ValueAnimator.INFINITE
      interpolator = LinearInterpolator()
      addUpdateListener {
        shimmer = it.animatedValue as Float
        invalidate()
      }
      start()
    }
  }

  /** A little push to the right and back — "this is how you close me". */
  fun nudge() {
    if (dragging || done) return
    animateTo(0.2f, t(180), DecelerateInterpolator()) { animateTo(0f, t(420), OvershootInterpolator(2.4f)) }
    performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
  }

  private fun animateTo(target: Float, dur: Long, interp: android.animation.TimeInterpolator, end: (() -> Unit)? = null) {
    settle?.cancel()
    if (dur <= 0) {
      progress = target
      invalidate()
      end?.invoke()
      return
    }
    settle = ValueAnimator.ofFloat(progress, target).apply {
      duration = dur
      interpolator = interp
      addUpdateListener {
        progress = it.animatedValue as Float
        invalidate()
      }
      if (end != null) addListener(object : android.animation.AnimatorListenerAdapter() {
        private var cancelled = false
        override fun onAnimationCancel(animation: android.animation.Animator) {
          cancelled = true
        }
        override fun onAnimationEnd(animation: android.animation.Animator) {
          if (!cancelled) end()
        }
      })
      start()
    }
  }

  private fun complete() {
    if (done) return
    done = true
    isEnabled = false
    animateTo(1f, t(140), DecelerateInterpolator()) {
      performHapticFeedback(if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.LONG_PRESS)
      onComplete()
    }
  }

  @SuppressLint("ClickableViewAccessibility")
  override fun onTouchEvent(e: MotionEvent): Boolean {
    if (done || !isEnabled) return false
    when (e.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        val tx = pad + travel * progress
        val onThumb = e.x >= tx - context.dp(14f) && e.x <= tx + thumbD + context.dp(14f)
        if (!onThumb) {
          nudge()
          return true
        }
        settle?.cancel()
        dragging = true
        ticked = false
        downX = e.x
        downProgress = progress
        parent?.requestDisallowInterceptTouchEvent(true)
        return true
      }
      MotionEvent.ACTION_MOVE -> {
        if (!dragging) return true
        progress = (downProgress + (e.x - downX) / travel).coerceIn(0f, 1f)
        if (!ticked && progress > 0.75f) {
          ticked = true
          performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
        } else if (ticked && progress < 0.7f) ticked = false
        invalidate()
        return true
      }
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
        if (!dragging) return true
        dragging = false
        if (progress > 0.75f && e.actionMasked == MotionEvent.ACTION_UP) complete()
        else animateTo(0f, t(460), OvershootInterpolator(1.6f))
        return true
      }
    }
    return super.onTouchEvent(e)
  }

  // Screen readers get a plain "activate to dismiss".
  override fun performClick(): Boolean {
    super.performClick()
    complete()
    return true
  }

  override fun onInitializeAccessibilityNodeInfo(info: AccessibilityNodeInfo) {
    super.onInitializeAccessibilityNodeInfo(info)
    info.className = android.widget.Button::class.java.name
  }

  override fun onDraw(c: Canvas) {
    val w = width.toFloat()
    val h = height.toFloat()
    val r = h / 2f
    rect.set(0f, 0f, w, h)
    c.drawRoundRect(rect, r, r, track)
    rect.inset(trackStroke.strokeWidth / 2f, trackStroke.strokeWidth / 2f)
    c.drawRoundRect(rect, r, r, trackStroke)

    val tx = pad + travel * progress
    if (progress > 0.001f) {
      fill.shader = LinearGradient(0f, 0f, w, 0f, Palette.alpha(Palette.ACCENT_A, 0.32f), Palette.alpha(Palette.ACCENT_B, 0.32f), Shader.TileMode.CLAMP)
      rect.set(0f, 0f, tx + thumbD + pad, h)
      c.drawRoundRect(rect, r, r, fill)
    }

    // Label, with a soft highlight sweeping across it.
    val a = (1f - progress * 1.8f).coerceIn(0f, 1f)
    if (a > 0f) {
      val cx = w / 2f + thumbD * 0.28f
      val sx = shimmer * w
      text.shader = LinearGradient(
        sx - w * 0.28f, 0f, sx + w * 0.28f, 0f,
        intArrayOf(Palette.alpha(Palette.TEXT_DIM, 0.55f * a), Palette.alpha(0xFFFFFFFF.toInt(), a), Palette.alpha(Palette.TEXT_DIM, 0.55f * a)),
        floatArrayOf(0f, 0.5f, 1f), Shader.TileMode.CLAMP
      )
      val fm = text.fontMetrics
      c.drawText(label, cx, h / 2f - (fm.ascent + fm.descent) / 2f, text)
    }

    // Thumb
    val cy = h / 2f
    val tr = thumbD / 2f
    thumb.shader = LinearGradient(tx, pad, tx + thumbD, pad + thumbD, Palette.ACCENT_A, Palette.ACCENT_B, Shader.TileMode.CLAMP)
    thumb.setShadowLayer(context.dp(10f), 0f, context.dp(3f), Palette.alpha(Palette.ACCENT_B, 0.45f))
    c.drawCircle(tx + tr, cy, tr, thumb)
    icon?.let {
      val s = (thumbD * 0.46f).toInt()
      val l = (tx + tr - s / 2f).toInt()
      val t = (cy - s / 2f).toInt()
      it.setBounds(l, t, l + s, t + s)
      it.draw(c)
    }
  }

  override fun onDetachedFromWindow() {
    shimmerAnim?.cancel()
    settle?.cancel()
    super.onDetachedFromWindow()
  }

  /** Stops accepting input (the screen is closing). */
  fun freeze() {
    done = true
    isEnabled = false
    shimmerAnim?.cancel()
  }
}
