package com.operarius.reminders

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import org.json.JSONObject

/** One scheduled reminder (the JS side's `NativeReminder`). */
data class Reminder(
  val id: String,
  val taskKey: String,
  val date: String?,
  val at: Long,
  val wall: String?,
  val intensity: String,
  val kind: String,
  val title: String,
  val emoji: String,
  val color: String,
  val startAt: Long,
  val endAt: Long,
  val timeText: String,
  val detail: String,
  /** Scheduled here rather than by the app (a snooze or a test) — app syncs leave it alone. */
  val native: Boolean = false,
  val snoozes: Int = 0,
) {
  /** Medium and intense reminders take over the screen. */
  val isScreen: Boolean get() = intensity == MEDIUM || intensity == INTENSE
  val isIntense: Boolean get() = intensity == INTENSE
  val isTest: Boolean get() = taskKey == TEST_KEY

  fun toJson(): JSONObject = JSONObject()
    .put("id", id)
    .put("taskKey", taskKey)
    .put("date", date ?: JSONObject.NULL)
    .put("at", at)
    .put("wall", wall ?: JSONObject.NULL)
    .put("intensity", intensity)
    .put("kind", kind)
    .put("title", title)
    .put("emoji", emoji)
    .put("color", color)
    .put("startAt", startAt)
    .put("endAt", endAt)
    .put("timeText", timeText)
    .put("detail", detail)
    .put("native", native)
    .put("snoozes", snoozes)

  override fun toString(): String = toJson().toString()

  companion object {
    const val EASY = "easy"
    const val MEDIUM = "medium"
    const val INTENSE = "intense"
    const val TEST_KEY = "__test"

    fun fromJson(o: JSONObject) = Reminder(
      id = o.getString("id"),
      taskKey = o.optString("taskKey"),
      date = o.optStringOrNull("date"),
      at = o.optLong("at"),
      wall = o.optStringOrNull("wall"),
      intensity = o.optString("intensity", EASY),
      kind = o.optString("kind", "custom"),
      title = o.optString("title"),
      emoji = o.optString("emoji"),
      color = o.optString("color", "#5B9DF9"),
      startAt = o.optLong("startAt"),
      endAt = o.optLong("endAt"),
      timeText = o.optString("timeText"),
      detail = o.optString("detail"),
      native = o.optBoolean("native"),
      snoozes = o.optInt("snoozes"),
    )

    fun parse(s: String?): Reminder? = try {
      s?.let { fromJson(JSONObject(it)) }
    } catch (_: Exception) {
      null
    }
  }
}

internal fun JSONObject.optStringOrNull(key: String): String? =
  if (!has(key) || isNull(key)) null else optString(key).ifEmpty { null }

/** The app's reminder settings (the JS side's `NativeConfig`). */
data class Config(
  val enabled: Boolean = true,
  val snoozeMin: Int = 10,
  val ringMin: Int = 0,
  val sound: String? = null,
  val soundName: String? = null,
  val vibrate: Boolean = true,
  val gentle: Boolean = true,
  val clock24: Boolean = true,
  /** The app's animation scale; 0 = animations off. */
  val animScale: Float = 1f,
) {
  fun toJson(): JSONObject = JSONObject()
    .put("enabled", enabled)
    .put("snoozeMin", snoozeMin)
    .put("ringMin", ringMin)
    .put("sound", sound ?: JSONObject.NULL)
    .put("soundName", soundName ?: JSONObject.NULL)
    .put("vibrate", vibrate)
    .put("gentle", gentle)
    .put("clock24", clock24)
    .put("animScale", animScale.toDouble())

  companion object {
    fun fromJson(o: JSONObject?): Config {
      if (o == null) return Config()
      return Config(
        enabled = o.optBoolean("enabled", true),
        snoozeMin = o.optInt("snoozeMin", 10).coerceIn(1, 60),
        ringMin = o.optInt("ringMin", 0).coerceIn(0, 60),
        sound = o.optStringOrNull("sound"),
        soundName = o.optStringOrNull("soundName"),
        vibrate = o.optBoolean("vibrate", true),
        gentle = o.optBoolean("gentle", true),
        clock24 = o.optBoolean("clock24", true),
        animScale = o.optDouble("animScale", 1.0).toFloat().coerceIn(0f, 4f),
      )
    }
  }
}

// ---- What arrives from JS ---------------------------------------------------

class ReminderRecord : Record {
  @Field val id: String = ""
  @Field val taskKey: String = ""
  @Field val date: String? = null
  @Field val at: Double = 0.0
  @Field val wall: String? = null
  @Field val intensity: String = Reminder.EASY
  @Field val kind: String = "custom"
  @Field val title: String = ""
  @Field val emoji: String = ""
  @Field val color: String = "#5B9DF9"
  @Field val startAt: Double = 0.0
  @Field val endAt: Double = 0.0
  @Field val timeText: String = ""
  @Field val detail: String = ""

  fun toReminder() = Reminder(
    id = id,
    taskKey = taskKey,
    date = date,
    at = at.toLong(),
    wall = wall,
    intensity = intensity,
    kind = kind,
    title = title,
    emoji = emoji,
    color = color,
    startAt = startAt.toLong(),
    endAt = endAt.toLong(),
    timeText = timeText,
    detail = detail,
  )
}

class ConfigRecord : Record {
  @Field val enabled: Boolean = true
  @Field val snoozeMin: Int = 10
  @Field val ringMin: Int = 0
  @Field val sound: String? = null
  @Field val soundName: String? = null
  @Field val vibrate: Boolean = true
  @Field val gentle: Boolean = true
  @Field val clock24: Boolean = true
  @Field val animScale: Double = 1.0

  fun toConfig() = Config(
    enabled = enabled,
    snoozeMin = snoozeMin.coerceIn(1, 60),
    ringMin = ringMin.coerceIn(0, 60),
    sound = sound,
    soundName = soundName,
    vibrate = vibrate,
    gentle = gentle,
    clock24 = clock24,
    animScale = animScale.toFloat().coerceIn(0f, 4f),
  )
}
