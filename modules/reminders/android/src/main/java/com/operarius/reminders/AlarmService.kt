package com.operarius.reminders

import android.app.ActivityManager
import android.app.KeyguardManager
import android.app.Notification
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.media.ToneGenerator
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import androidx.core.content.ContextCompat

/**
 * The reminder that's on screen right now (medium / intense), kept alive as a
 * foreground service until it's answered:
 *
 *  • shows the reminder screen — over the lock screen through the full-screen
 *    notification, or straight over whatever app you're in (our own activity if
 *    the app is open, otherwise an overlay when "Display over other apps" is on);
 *  • medium: one short buzz + the notification sound;
 *  • intense: the alarm sound on a loop (optionally fading in) and vibration in
 *    pulses, until dismissed — or until the configured ring time runs out.
 */
class AlarmService : Service() {
  companion object {
    private const val ACTION_START = "com.operarius.reminders.action.START"
    private const val EXTRA = "reminder"
    private const val MIN = 60_000L
    private const val MEDIUM_TIMEOUT = 30 * MIN

    /** Three strong pulses, then a breath — repeated. */
    private val PULSES = longArrayOf(0, 420, 220, 420, 220, 420, 1100)
    private val PULSE_AMPS = intArrayOf(0, 255, 0, 255, 0, 255, 0)

    @Volatile private var instance: AlarmService? = null

    /** The reminder on screen / ringing right now. */
    val current: Reminder? get() = instance?.active
    val silenced: Boolean get() = instance?.silenced == true

    fun start(ctx: Context, r: Reminder) {
      val i = Intent(ctx, AlarmService::class.java).setAction(ACTION_START).putExtra(EXTRA, r.toString())
      try {
        ContextCompat.startForegroundService(ctx, i)
      } catch (_: Exception) {
        // Not allowed to start right now — at least don't lose the reminder.
        Notifications.showReminder(ctx, r)
      }
    }

    /** Ends reminder `id` if it's the one on screen (answered from anywhere). */
    fun finish(ctx: Context, id: String) {
      val s = instance
      if (s != null && s.active?.id == id) s.end() else AlarmBus.closed(id)
    }

    fun silence() {
      instance?.silenceNow()
    }
  }

  private var active: Reminder? = null
  private var silenced = false
  private var selfShown = false // our own screen is up, so the notification is the quiet one
  private var startedAt = 0L
  private var player: MediaPlayer? = null
  private var tone: ToneGenerator? = null
  private var vibrator: Vibrator? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private var focus: AudioFocusRequest? = null
  private var volume = 1f
  private val main = Handler(Looper.getMainLooper())

  private val ramp = object : Runnable {
    override fun run() {
      val p = player ?: return
      volume = minOf(1f, volume + 0.88f / 120f) // ~30 s to full volume
      try {
        p.setVolume(volume, volume)
      } catch (_: Exception) {
        return
      }
      if (volume < 1f) main.postDelayed(this, 250)
    }
  }
  private val toneLoop = object : Runnable {
    override fun run() {
      tone?.startTone(ToneGenerator.TONE_CDMA_ALERT_CALL_GUARD, 700)
      main.postDelayed(this, 1500)
    }
  }
  private val timeout = Runnable { onTimeout() }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
  }

  override fun onDestroy() {
    main.removeCallbacksAndMessages(null)
    stopOutputs()
    releaseWake()
    AlarmOverlay.hide(animated = true) // lets a running fade-out finish
    active?.let { AlarmBus.closed(it.id) }
    active = null
    if (instance === this) instance = null
    super.onDestroy()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val r = if (intent?.action == ACTION_START) Reminder.parse(intent.getStringExtra(EXTRA)) else null
    if (r == null) {
      // Started without a reminder (shouldn't happen) — satisfy the foreground
      // contract, then go away unless something is already on screen.
      val cur = active
      if (cur != null) goForeground(Notifications.alarm(this, cur, fullScreen = !selfShown, silenced = silenced), cur)
      else {
        goForeground(Notifications.alarm(this, placeholder(), fullScreen = false, silenced = true), null)
        stopSelf()
      }
      return START_NOT_STICKY
    }
    begin(r)
    return START_NOT_STICKY
  }

  private fun placeholder() = Reminder("", "", null, System.currentTimeMillis(), null, Reminder.MEDIUM, "custom", "Reminder", "🔔", "#4FD1C5", 0, 0, "", "")

  private fun begin(r: Reminder) {
    val cfg = Store.config(this)
    val prev = active
    if (prev != null && prev.id != r.id) {
      if (prev.isIntense && !r.isIntense && !silenced) {
        // A quieter reminder never interrupts a ringing alarm — it becomes a notification.
        goForeground(Notifications.alarm(this, prev, fullScreen = false, silenced = false), prev)
        Notifications.showReminder(this, r)
        return
      }
      // The new one takes over; the earlier one stays in the shade.
      main.removeCallbacks(timeout)
      stopOutputs()
      AlarmOverlay.hide(animated = false)
      AlarmBus.closed(prev.id)
      Notifications.showReminder(this, prev)
    }
    active = r
    silenced = false
    startedAt = System.currentTimeMillis()

    val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
    val km = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    val inUse = pm.isInteractive && !km.isKeyguardLocked
    val appVisible = isAppVisible()
    val canOverlay = Settings.canDrawOverlays(this)
    selfShown = inUse && (appVisible || canOverlay)

    if (!goForeground(Notifications.alarm(this, r, fullScreen = !selfShown, silenced = false), r)) return
    acquireWake(cfg)

    if (selfShown) {
      val shown = if (appVisible) startScreen(r) else AlarmOverlay.show(this, r)
      if (!shown) {
        // Couldn't draw it ourselves — let the system show the full-screen notification.
        selfShown = false
        Notifications.update(this, Notifications.ALARM_ID, Notifications.alarm(this, r, fullScreen = true, silenced = false))
      }
    }

    if (r.isIntense) ring(cfg) else buzzOnce()
    val limit = if (r.isIntense) cfg.ringMin * MIN else MEDIUM_TIMEOUT
    if (limit > 0) main.postDelayed(timeout, limit)
  }

  private fun goForeground(n: Notification, r: Reminder?): Boolean = try {
    if (Build.VERSION.SDK_INT >= 34) startForeground(Notifications.ALARM_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SYSTEM_EXEMPTED)
    else startForeground(Notifications.ALARM_ID, n)
    true
  } catch (_: Exception) {
    // No foreground allowed (e.g. exact-alarm access revoked on Android 12) — a
    // short service still lets us post the reminder and bow out cleanly.
    try {
      if (Build.VERSION.SDK_INT >= 34) startForeground(Notifications.ALARM_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE)
    } catch (_: Exception) {
    }
    r?.let { Notifications.showReminder(this, it) }
    active = null
    stopSelf()
    false
  }

  private fun isAppVisible(): Boolean {
    val info = ActivityManager.RunningAppProcessInfo()
    ActivityManager.getMyMemoryState(info)
    return info.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
  }

  private fun startScreen(r: Reminder): Boolean = try {
    startActivity(AlarmActivity.intent(this, r))
    true
  } catch (_: Exception) {
    false
  }

  // ---- Sound & vibration ------------------------------------------------------

  private fun ring(cfg: Config) {
    val audio = getSystemService(Context.AUDIO_SERVICE) as AudioManager
    if (cfg.vibrate) vibrate(PULSES, PULSE_AMPS, repeat = true)
    // On a call: vibrate only, never blast an alarm into someone's ear.
    if (audio.mode == AudioManager.MODE_IN_CALL || audio.mode == AudioManager.MODE_IN_COMMUNICATION) return
    val attrs = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_ALARM)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()
    requestFocus(audio, attrs)
    val mp = Sounds.candidates(this, cfg.sound).firstNotNullOfOrNull { createPlayer(it, attrs) }
    if (mp == null) {
      tone = try {
        ToneGenerator(AudioManager.STREAM_ALARM, 90)
      } catch (_: Exception) {
        null
      }
      main.post(toneLoop)
      return
    }
    player = mp
    volume = if (cfg.gentle) 0.12f else 1f
    mp.setVolume(volume, volume)
    mp.start()
    if (cfg.gentle) main.postDelayed(ramp, 250)
  }

  private fun createPlayer(uri: Uri, attrs: AudioAttributes): MediaPlayer? {
    val mp = MediaPlayer()
    return try {
      mp.setAudioAttributes(attrs)
      mp.setDataSource(this, uri)
      mp.isLooping = true
      mp.setWakeMode(this, PowerManager.PARTIAL_WAKE_LOCK)
      mp.prepare()
      mp
    } catch (_: Exception) {
      mp.release()
      null
    }
  }

  /** Medium: one short buzz, plus the notification sound (it follows silent / vibrate mode). */
  private fun buzzOnce() {
    vibrate(longArrayOf(0, 380), intArrayOf(0, 230), repeat = false)
    val audio = getSystemService(Context.AUDIO_SERVICE) as AudioManager
    if (audio.ringerMode != AudioManager.RINGER_MODE_NORMAL) return
    try {
      RingtoneManager.getRingtone(this, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION))?.apply {
        audioAttributes = AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_NOTIFICATION)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build()
        play()
      }
    } catch (_: Exception) {
    }
  }

  private fun vibratorService(): Vibrator? =
    if (Build.VERSION.SDK_INT >= 31) (getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
    else @Suppress("DEPRECATION") (getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator)

  private fun vibrate(timings: LongArray, amps: IntArray, repeat: Boolean) {
    val v = vibrator ?: vibratorService()?.also { vibrator = it } ?: return
    if (!v.hasVibrator()) return
    val rep = if (repeat) 0 else -1
    val audioAttrs = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build()
    try {
      if (Build.VERSION.SDK_INT >= 26) {
        val effect = if (v.hasAmplitudeControl()) VibrationEffect.createWaveform(timings, amps, rep) else VibrationEffect.createWaveform(timings, rep)
        if (Build.VERSION.SDK_INT >= 33) v.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM))
        else @Suppress("DEPRECATION") v.vibrate(effect, audioAttrs)
      } else {
        @Suppress("DEPRECATION") v.vibrate(timings, rep, audioAttrs)
      }
    } catch (_: Exception) {
    }
  }

  private fun requestFocus(audio: AudioManager, attrs: AudioAttributes) {
    try {
      if (Build.VERSION.SDK_INT >= 26) {
        val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
          .setAudioAttributes(attrs)
          .setOnAudioFocusChangeListener { }
          .build()
        focus = req
        audio.requestAudioFocus(req)
      } else {
        @Suppress("DEPRECATION") audio.requestAudioFocus(null, AudioManager.STREAM_ALARM, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
      }
    } catch (_: Exception) {
    }
  }

  private fun abandonFocus() {
    val audio = getSystemService(Context.AUDIO_SERVICE) as AudioManager
    try {
      if (Build.VERSION.SDK_INT >= 26) focus?.let { audio.abandonAudioFocusRequest(it) }
      else @Suppress("DEPRECATION") audio.abandonAudioFocus(null)
    } catch (_: Exception) {
    }
    focus = null
  }

  private fun stopOutputs() {
    main.removeCallbacks(ramp)
    main.removeCallbacks(toneLoop)
    player?.let {
      try {
        it.stop()
      } catch (_: Exception) {
      }
      it.release()
    }
    player = null
    tone?.release()
    tone = null
    vibrator?.cancel()
    abandonFocus()
  }

  private fun acquireWake(cfg: Config) {
    if (wakeLock?.isHeld == true) return
    val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "operarius:reminder").apply {
      setReferenceCounted(false)
      acquire(if (cfg.ringMin > 0) (cfg.ringMin + 1) * MIN else 60 * MIN)
    }
  }

  private fun releaseWake() {
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
  }

  // ---- Answers ------------------------------------------------------------------

  /** Volume key on the screen: stop the noise, keep the reminder up. */
  private fun silenceNow() {
    val r = active ?: return
    if (silenced) return
    silenced = true
    stopOutputs()
    Notifications.update(this, Notifications.ALARM_ID, Notifications.alarm(this, r, fullScreen = false, silenced = true))
    AlarmBus.silenced(r.id)
  }

  private fun onTimeout() {
    val r = active ?: return
    if (r.isIntense) Notifications.showMissed(this, r, rangFor = System.currentTimeMillis() - startedAt)
    else Notifications.showReminder(this, r)
    end()
  }

  /** Answered (or given up): quiet, close the screen, leave the foreground. */
  fun end() {
    val r = active
    main.removeCallbacks(timeout)
    stopOutputs()
    releaseWake()
    active = null
    silenced = false
    AlarmOverlay.hide(animated = true)
    r?.let { AlarmBus.closed(it.id) }
    if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE) else @Suppress("DEPRECATION") stopForeground(true)
    stopSelf()
  }
}
