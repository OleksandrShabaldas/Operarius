package com.operarius.reminders

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Everything the reminders need to survive a killed app or a reboot: the
 * scheduled reminders, the settings, and actions taken while the app was
 * closed ("Done" on a notification) that the app applies when it next runs.
 *
 * Small JSON blobs in SharedPreferences, written synchronously (receivers may
 * be killed right after they return).
 */
internal object Store {
  private const val PREFS = "operarius.reminders"
  private const val K_ITEMS = "items"
  private const val K_CONFIG = "config"
  private const val K_ACTIONS = "actions"

  private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  @Synchronized
  fun all(ctx: Context): List<Reminder> {
    val raw = prefs(ctx).getString(K_ITEMS, null) ?: return emptyList()
    return try {
      val arr = JSONArray(raw)
      List(arr.length()) { Reminder.fromJson(arr.getJSONObject(it)) }
    } catch (_: Exception) {
      emptyList()
    }
  }

  @Synchronized
  fun saveAll(ctx: Context, list: List<Reminder>) {
    val arr = JSONArray()
    list.forEach { arr.put(it.toJson()) }
    prefs(ctx).edit().putString(K_ITEMS, arr.toString()).commit()
  }

  @Synchronized
  fun put(ctx: Context, r: Reminder) = saveAll(ctx, all(ctx).filter { it.id != r.id } + r)

  /** Removes and returns the reminder (null if it was already gone — e.g. cancelled by a sync). */
  @Synchronized
  fun take(ctx: Context, id: String): Reminder? {
    val list = all(ctx)
    val r = list.firstOrNull { it.id == id } ?: return null
    saveAll(ctx, list.filter { it.id != id })
    return r
  }

  @Synchronized
  fun removeWhere(ctx: Context, pred: (Reminder) -> Boolean): List<Reminder> {
    val list = all(ctx)
    val (gone, kept) = list.partition(pred)
    if (gone.isNotEmpty()) saveAll(ctx, kept)
    return gone
  }

  @Synchronized
  fun config(ctx: Context): Config =
    Config.fromJson(prefs(ctx).getString(K_CONFIG, null)?.let { runCatching { JSONObject(it) }.getOrNull() })

  @Synchronized
  fun saveConfig(ctx: Context, c: Config) {
    prefs(ctx).edit().putString(K_CONFIG, c.toJson().toString()).commit()
  }

  @Synchronized
  fun pushAction(ctx: Context, type: String, r: Reminder) {
    val arr = runCatching { JSONArray(prefs(ctx).getString(K_ACTIONS, "[]")) }.getOrDefault(JSONArray())
    arr.put(
      JSONObject()
        .put("type", type)
        .put("taskKey", r.taskKey)
        .put("date", r.date ?: JSONObject.NULL)
        .put("at", System.currentTimeMillis())
    )
    // Keep the queue bounded even if the app is never opened.
    val trimmed = JSONArray()
    for (i in maxOf(0, arr.length() - 100) until arr.length()) trimmed.put(arr.get(i))
    prefs(ctx).edit().putString(K_ACTIONS, trimmed.toString()).commit()
  }

  @Synchronized
  fun takeActions(ctx: Context): List<Map<String, Any?>> {
    val raw = prefs(ctx).getString(K_ACTIONS, null) ?: return emptyList()
    prefs(ctx).edit().remove(K_ACTIONS).commit()
    return try {
      val arr = JSONArray(raw)
      List(arr.length()) {
        val o = arr.getJSONObject(it)
        mapOf(
          "type" to o.optString("type"),
          "taskKey" to o.optString("taskKey"),
          "date" to o.optStringOrNull("date"),
          "at" to o.optLong("at").toDouble(),
        )
      }
    } catch (_: Exception) {
      emptyList()
    }
  }
}
