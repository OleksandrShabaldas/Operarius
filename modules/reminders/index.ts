import { NativeModule, requireOptionalNativeModule } from 'expo';

// ---------------------------------------------------------------------------
// Operarius reminders — the JS face of the Android module in ./android.
//
// The app hands over the full list of upcoming reminders (already expanded
// from the tasks) and the native side keeps them scheduled with exact alarms,
// survives reboots / updates / time-zone changes, and fires them at one of
// three intensities. On web (and anywhere the module isn't linked) every call
// is a harmless no-op, so the UI works everywhere.
// ---------------------------------------------------------------------------

export type Intensity = 'easy' | 'medium' | 'intense';

// One scheduled reminder, as the native side stores it.
export type NativeReminder = {
  id: string; // stable: task occurrence + which reminder
  taskKey: string; // the task instance (a repeating occurrence is "<id>@<date>")
  date: string | null; // the occurrence's day (to open it), null for to-dos
  at: number; // when it fires (epoch ms)
  wall: string | null; // the same moment as local wall time "YYYY-MM-DDTHH:mm" (kept on time-zone changes)
  intensity: Intensity;
  kind: 'before' | 'after' | 'custom';
  title: string;
  emoji: string;
  color: string;
  startAt: number; // the occurrence's start / end (epoch ms, 0 = none) — for "Starts in 10 min"
  endAt: number;
  timeText: string; // "11:30 – 12:00", "All day", "To-do"
  detail: string; // "Work · Office"
  subsLeft: number; // open subtasks — while any are, "Done" becomes "Open" (a task completes with its subtasks)
};

export type NativeConfig = {
  enabled: boolean;
  snoozeMin: number;
  ringMin: number; // 0 = until dismissed
  sound: string | null; // null = the phone's default alarm sound
  soundName: string | null;
  vibrate: boolean;
  gentle: boolean;
  clock24: boolean;
  animScale: number; // the app's animation scale (0 = animations off)
};

// Everything that decides whether a reminder can arrive on time.
export type ReminderStatus = {
  sdk: number;
  notifications: boolean; // allowed to post notifications
  exactAlarms: boolean; // "Alarms & reminders" special access
  fullScreen: boolean; // full-screen alerts (Android 14+)
  overlay: boolean; // "Display over other apps"
  battery: boolean; // exempt from battery optimization
  restricted: boolean; // background usage restricted by the user
  alarmVolume: number; // 0…1
  manufacturer: string;
  autostart: boolean; // the phone has a vendor "auto-start" screen we can open
};

export type ReminderAction = { type: 'done' | 'open'; taskKey: string; date: string | null; at: number };

export type SettingsTarget = 'notifications' | 'exact' | 'fullScreen' | 'overlay' | 'battery' | 'app' | 'autostart' | 'sound';

export type PickedSound = { uri: string | null; name: string };

type Events = {
  onAction: (a: ReminderAction) => void;
};

declare class RemindersNative extends NativeModule<Events> {
  sync(items: NativeReminder[], live: string[], config: NativeConfig): Promise<void>;
  getStatus(): Promise<ReminderStatus>;
  requestNotifications(): Promise<boolean>;
  openSettings(target: SettingsTarget): Promise<boolean>;
  test(sample: NativeReminder, delaySec: number): Promise<void>;
  takeActions(): Promise<ReminderAction[]>;
  pickSound(current: string | null): Promise<PickedSound | null>;
  soundName(uri: string | null): Promise<string>;
}

const Native = requireOptionalNativeModule<RemindersNative>('OperariusReminders');

/** True where reminders can actually fire (the Android app). */
export const available = !!Native;

/**
 * Replaces the schedule with `items`. `live` lists the task occurrences that
 * may still remind (not deleted / completed) — a snooze of anything else is
 * cancelled.
 */
export async function sync(items: NativeReminder[], live: string[], config: NativeConfig): Promise<void> {
  if (!Native) return;
  try {
    await Native.sync(items, live, config);
  } catch (e) {
    console.warn('[reminders] sync failed', e);
  }
}

export async function getStatus(): Promise<ReminderStatus | null> {
  if (!Native) return null;
  try {
    return await Native.getStatus();
  } catch {
    return null;
  }
}

/** Asks for the notification permission (Android 13+). Resolves to whether notifications are allowed. */
export async function requestNotifications(): Promise<boolean> {
  if (!Native) return false;
  try {
    return await Native.requestNotifications();
  } catch {
    return false;
  }
}

/** Opens the system screen that fixes `target`. Resolves to false if nothing could be opened. */
export async function openSettings(target: SettingsTarget): Promise<boolean> {
  if (!Native) return false;
  try {
    return await Native.openSettings(target);
  } catch {
    return false;
  }
}

/** Fires `sample` in `delaySec` seconds (outside the task schedule). */
export async function test(sample: NativeReminder, delaySec: number): Promise<void> {
  if (!Native) return;
  await Native.test(sample, delaySec);
}

/** Actions taken on notifications / the alarm screen while the app was closed (e.g. "Done"). */
export async function takeActions(): Promise<ReminderAction[]> {
  if (!Native) return [];
  try {
    return await Native.takeActions();
  } catch {
    return [];
  }
}

/** The system alarm-sound picker. null = cancelled. */
export async function pickSound(current: string | null): Promise<PickedSound | null> {
  if (!Native) return null;
  try {
    return await Native.pickSound(current);
  } catch {
    return null;
  }
}

export async function soundName(uri: string | null): Promise<string> {
  if (!Native) return 'Default alarm';
  try {
    return await Native.soundName(uri);
  } catch {
    return 'Default alarm';
  }
}

export function addActionListener(cb: (a: ReminderAction) => void): () => void {
  if (!Native) return () => {};
  const sub = Native.addListener('onAction', cb);
  return () => sub.remove();
}
