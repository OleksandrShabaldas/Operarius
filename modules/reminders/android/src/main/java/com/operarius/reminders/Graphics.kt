package com.operarius.reminders

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.text.TextPaint
import androidx.core.graphics.ColorUtils

/** The app's palette (src/theme.ts) and small drawing helpers. */
internal object Palette {
  const val BG = 0xFF0B0B0D.toInt()
  const val TEXT = 0xFFF4F4F6.toInt()
  const val TEXT_DIM = 0xFFC8C8CE.toInt()
  const val MUTED = 0xFF8A8A92.toInt()
  const val FAINT = 0xFF5B5B63.toInt()
  const val ACCENT_A = 0xFF7C7CF0.toInt() // indigo
  const val ACCENT_B = 0xFF4FD1C5.toInt() // teal
  const val DANGER = 0xFFFF6B70.toInt()

  fun parse(hex: String?, fallback: Int = ACCENT_B): Int = try {
    if (hex.isNullOrBlank()) fallback else Color.parseColor(hex)
  } catch (_: IllegalArgumentException) {
    fallback
  }

  fun alpha(c: Int, a: Float): Int = ColorUtils.setAlphaComponent(c, (a.coerceIn(0f, 1f) * 255).toInt())
  fun mix(a: Int, b: Int, t: Float): Int = ColorUtils.blendARGB(a, b, t)

  /** The accent a screen of this intensity uses. */
  fun accentFor(r: Reminder): Int = if (r.isIntense) DANGER else ACCENT_B
}

internal fun Context.dp(v: Float): Float = v * resources.displayMetrics.density
internal fun Context.dpi(v: Float): Int = (v * resources.displayMetrics.density + 0.5f).toInt()

internal object Graphics {
  /** The task's marker (gradient tile + emoji) as a notification large icon. */
  fun taskIcon(ctx: Context, r: Reminder, sizeDp: Float = 64f): Bitmap {
    val size = ctx.dpi(sizeDp).coerceAtLeast(48)
    val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val c = Canvas(bmp)
    val color = Palette.parse(r.color)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      shader = LinearGradient(0f, 0f, size.toFloat(), size.toFloat(), color, Palette.mix(color, Color.BLACK, 0.28f), Shader.TileMode.CLAMP)
    }
    val rad = size * 0.3f
    c.drawRoundRect(RectF(0f, 0f, size.toFloat(), size.toFloat()), rad, rad, paint)
    val emoji = r.emoji.ifBlank { "🔔" }
    val tp = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
      textSize = size * (if (emoji.length <= 2 && emoji.all { it.isLetterOrDigit() }) 0.4f else 0.5f)
      textAlign = Paint.Align.CENTER
      this.color = Palette.BG
      isFakeBoldText = emoji.all { it.isLetterOrDigit() }
    }
    val y = size / 2f - (tp.descent() + tp.ascent()) / 2f
    c.drawText(emoji, size / 2f, y, tp)
    return bmp
  }
}
