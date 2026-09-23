package com.operarius.reminders

import android.app.Activity
import android.app.ActivityManager
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioManager
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings

/** Everything that decides whether a reminder arrives on time — and the screens that fix it. */
internal object Status {
  fun get(ctx: Context): Map<String, Any> {
    val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
    val audio = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val maxVol = audio.getStreamMaxVolume(AudioManager.STREAM_ALARM).coerceAtLeast(1)
    return mapOf(
      "sdk" to Build.VERSION.SDK_INT,
      "notifications" to Notifications.enabled(ctx),
      "exactAlarms" to Scheduler.canExact(ctx),
      "fullScreen" to (Build.VERSION.SDK_INT < 34 || nm.canUseFullScreenIntent()),
      "overlay" to Settings.canDrawOverlays(ctx),
      "battery" to pm.isIgnoringBatteryOptimizations(ctx.packageName),
      "restricted" to (Build.VERSION.SDK_INT >= 28 && am.isBackgroundRestricted),
      "alarmVolume" to audio.getStreamVolume(AudioManager.STREAM_ALARM).toDouble() / maxVol,
      "manufacturer" to Build.MANUFACTURER.lowercase(),
      "autostart" to (Oem.autostart(ctx) != null),
    )
  }

  /** Opens the system screen for `target`; false if none could be opened. */
  fun open(ctx: Context, target: String): Boolean {
    val pkg = ctx.packageName
    val pkgUri = Uri.parse("package:$pkg")
    val details = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkgUri)
    val tries: List<Intent> = when (target) {
      "notifications" -> if (Build.VERSION.SDK_INT >= 26) listOf(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg), details) else listOf(details)
      "exact" -> if (Build.VERSION.SDK_INT >= 31) listOf(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, pkgUri), details) else listOf(details)
      "fullScreen" -> if (Build.VERSION.SDK_INT >= 34) listOf(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, pkgUri), details) else listOf(details)
      "overlay" -> listOf(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, pkgUri), Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION), details)
      "battery" -> listOf(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, pkgUri), Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS), details)
      "autostart" -> listOfNotNull(Oem.autostart(ctx), details)
      "sound" -> listOf(Intent(Settings.ACTION_SOUND_SETTINGS), details)
      else -> listOf(details)
    }
    for (i in tries) {
      try {
        if (ctx !is Activity) i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(i)
        return true
      } catch (_: Exception) {
      }
    }
    return false
  }
}

/**
 * Some vendors (Xiaomi, Huawei, Oppo, Vivo, OnePlus, …) stop apps in the
 * background unless you whitelist them in their own "auto-start" screen.
 */
internal object Oem {
  private val screens = listOf(
    "com.miui.securitycenter" to "com.miui.permcenter.autostart.AutoStartManagementActivity",
    "com.huawei.systemmanager" to "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity",
    "com.huawei.systemmanager" to "com.huawei.systemmanager.optimize.process.ProtectActivity",
    "com.hihonor.systemmanager" to "com.hihonor.systemmanager.startupmgr.ui.StartupNormalAppListActivity",
    "com.coloros.safecenter" to "com.coloros.safecenter.permission.startup.StartupAppListActivity",
    "com.coloros.safecenter" to "com.coloros.safecenter.startupapp.StartupAppListActivity",
    "com.oppo.safe" to "com.oppo.safe.permission.startup.StartupAppListActivity",
    "com.vivo.permissionmanager" to "com.vivo.permissionmanager.activity.BgStartUpManagerActivity",
    "com.iqoo.secure" to "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity",
    "com.oneplus.security" to "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity",
    "com.asus.mobilemanager" to "com.asus.mobilemanager.autostart.AutoStartActivity",
    "com.letv.android.letvsafe" to "com.letv.android.letvsafe.AutobootManageActivity",
    "com.samsung.android.lool" to "com.samsung.android.sm.ui.battery.BatteryActivity",
  )

  fun autostart(ctx: Context): Intent? {
    val pm = ctx.packageManager
    for ((pkg, cls) in screens) {
      val i = Intent().setComponent(ComponentName(pkg, cls))
      val info = try {
        pm.resolveActivity(i, PackageManager.MATCH_DEFAULT_ONLY)
      } catch (_: Exception) {
        null
      } ?: continue
      if (info.activityInfo?.exported == true) return i
    }
    return null
  }
}

/** The alarm sound: what to play, and what it's called. */
internal object Sounds {
  fun candidates(ctx: Context, chosen: String?): List<Uri> = listOfNotNull(
    chosen?.let { runCatching { Uri.parse(it) }.getOrNull() },
    RingtoneManager.getActualDefaultRingtoneUri(ctx, RingtoneManager.TYPE_ALARM),
    RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM),
    RingtoneManager.getActualDefaultRingtoneUri(ctx, RingtoneManager.TYPE_RINGTONE),
    RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
  ).distinct()

  fun name(ctx: Context, uri: String?): String {
    if (uri.isNullOrBlank()) {
      val actual = RingtoneManager.getActualDefaultRingtoneUri(ctx, RingtoneManager.TYPE_ALARM)
      val t = actual?.let { title(ctx, it) }
      return if (t.isNullOrBlank()) "Default alarm" else "Default ($t)"
    }
    return title(ctx, Uri.parse(uri)) ?: "Alarm"
  }

  fun title(ctx: Context, uri: Uri): String? = try {
    RingtoneManager.getRingtone(ctx, uri)?.getTitle(ctx)
  } catch (_: Exception) {
    null
  }
}
