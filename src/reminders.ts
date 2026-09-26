import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as Native from '../modules/reminders';
import type { NativeConfig, NativeReminder } from '../modules/reminders';
import { instanceId, occursOn } from './recurrence';
import { C } from './theme';
import { Clock, CustomReminder, Draft, ReminderIntensity, Reminders, Settings, Task, TaskType } from './types';
import { addDays, dateKey, dateLabel, findTag, fmt, genId, shownTitle, tagLabel } from './utils';

// ---------------------------------------------------------------------------
// Reminders — turning each task's reminder settings into the concrete list of
// alarms the native side keeps scheduled.
//
//  • "before" / "after" are relative to the task (planned: its start / end;
//    all-day: the visible day window), so they follow the task when it moves
//    and fire for every occurrence of a repeating task.
//  • custom reminders sit at a fixed local date & time.
//  • completed occurrences never remind.
//
// The schedule covers the next HORIZON_DAYS; opening the app (or any change)
// re-syncs, so repeating tasks keep getting fresh alarms.
// ---------------------------------------------------------------------------

/** Each intensity's colour (bells on cards, chips, the picker's highlight). */
export const INTENSITY_COLOR: Record<ReminderIntensity, string> = { easy: C.accentB, medium: C.accentA, intense: C.band };

export const HORIZON_DAYS = 21;
const MAX_SCHEDULED = 300; // Android allows 500 alarms per app — stay well below
const DAY = 86400000;

// Offsets offered for "before start" / "after end" (minutes).
export const OFFSETS = [0, 5, 10, 15, 20, 25, 30, 40, 45, 50, 60, 75, 90, 105, 120, 150, 180, 240, 300, 360, 480, 720, 1080, 1440];

export function fmtOffset(min: number): string {
  if (min < 60) return `${min} min`;
  if (min % 1440 === 0) return min === 1440 ? '1 day' : `${min / 1440} days`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h} hr`;
}

export const hasReminders = (r: Reminders | null | undefined): r is Reminders =>
  !!r && (r.before != null || r.after != null || r.custom.length > 0);

/** Collapses an empty set to null (the stored "no reminders"). */
export const tidyReminders = (r: Reminders | null): Reminders | null => (hasReminders(r) ? r : null);

/** How a task's reminders start: its tag's intensity, its parent tag's, or the default. */
export function intensityFor(s: Pick<Settings, 'tags' | 'reminderDefault'>, tagId: string | null | undefined): ReminderIntensity {
  const tag = tagId ? s.tags.find((t) => t.id === tagId) : null;
  if (tag?.intensity) return tag.intensity;
  const parent = tag?.parentId ? s.tags.find((t) => t.id === tag.parentId) : null;
  return parent?.intensity ?? s.reminderDefault.intensity;
}

/** A blank set, at the intensity its tag (or the default) asks for. */
export const blankReminders = (s: Settings, tagId?: string | null): Reminders => ({ before: null, after: null, custom: [], intensity: intensityFor(s, tagId) });

/** What a brand-new task starts with (Settings → Reminders → New tasks). */
export function defaultReminders(s: Settings, tagId?: string | null): Reminders | null {
  const b = s.reminderDefault.before;
  return b == null ? null : { before: b, after: null, custom: [], intensity: intensityFor(s, tagId) };
}

/** Reminders carried into a copy / from a name suggestion: the relative ones, plus custom ones still ahead. */
export function carryReminders(r: Reminders | null, now = Date.now()): Reminders | null {
  if (!r) return null;
  return tidyReminders({ ...r, custom: r.custom.filter((c) => localMs(c.date, c.min) > now).map((c) => ({ ...c, id: genId() })) });
}

/** Relative reminders need a time: planned tasks use their own, all-day ones the day window, to-dos have none. */
export const hasTime = (type: TaskType) => type !== 'todo';

// The minutes-of-day window a task occupies on its day.
export function taskWindow(t: Pick<Task, 'type' | 'start' | 'dur'>, s: Pick<Settings, 'dayStart' | 'dayEnd'>): { start: number; end: number } | null {
  if (t.type === 'planned') return { start: t.start, end: t.start + t.dur };
  if (t.type === 'allday') return { start: s.dayStart, end: s.dayEnd };
  return null;
}

// Local wall time → epoch ms. `min` may run past either end of the day (Date
// normalises it in local time, so DST days land on the right wall time).
export function localMs(key: string, min: number): number {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 0, min).getTime();
}

const pad = (n: number) => String(n).padStart(2, '0');
function wallOf(ms: number): string {
  const d = new Date(ms);
  return `${dateKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export type Fire = {
  id: string; // stable per occurrence + reminder
  taskKey: string;
  date: string | null;
  kind: 'before' | 'after' | 'custom';
  at: number;
  startAt: number;
  endAt: number;
  offset: number; // before / after: minutes; custom: 0
};

// Every moment a task reminds you in [from, to).
export function taskFires(t: Task, s: Settings, from: number, to: number): Fire[] {
  const r = t.reminders;
  if (!hasReminders(r)) return [];
  const out: Fire[] = [];
  const win = taskWindow(t, s);
  const occDone = (d: string) => (t.repeat ? t.doneDates.includes(d) : t.done);

  const relative = (d: string) => {
    if (!win || occDone(d)) return;
    const key = t.repeat ? instanceId(t.id, d) : t.id;
    const startAt = localMs(d, win.start);
    const endAt = localMs(d, win.end);
    if (r.before != null) out.push({ id: `${key}|before`, taskKey: key, date: d, kind: 'before', at: localMs(d, win.start - r.before), startAt, endAt, offset: r.before });
    if (r.after != null) out.push({ id: `${key}|after`, taskKey: key, date: d, kind: 'after', at: localMs(d, win.end + r.after), startAt, endAt, offset: r.after });
  };

  if (win && t.date && (r.before != null || r.after != null)) {
    if (!t.repeat) relative(t.date);
    else {
      // Offsets reach at most a day either way, so a 2-day margin covers every
      // occurrence that can fire inside the window.
      const first = dateKey(new Date(from - 2 * DAY));
      const days = Math.ceil((to - from) / DAY) + 4;
      for (let i = 0; i < days; i++) {
        const d = addDays(first, i);
        if (occursOn(t, d)) relative(d);
      }
    }
  }

  for (const c of r.custom) {
    const at = localMs(c.date, c.min);
    if (at < from || at >= to) continue;
    const occ = customOccurrence(t, c);
    if (occ && occDone(occ)) continue;
    if (!occ && t.done) continue;
    const key = occ && t.repeat ? instanceId(t.id, occ) : t.id;
    const startAt = occ && win ? localMs(occ, win.start) : 0;
    const endAt = occ && win ? localMs(occ, win.end) : 0;
    out.push({ id: `${key}|custom|${c.id}`, taskKey: key, date: occ, kind: 'custom', at, startAt, endAt, offset: 0 });
  }
  return out.filter((f) => f.at >= from && f.at < to);
}

// The occurrence a custom reminder belongs to: the task's own day, or — for a
// repeating task — the first occurrence on/after the reminder's day.
function customOccurrence(t: Task, c: CustomReminder): string | null {
  if (!t.date || t.type === 'todo') return null;
  if (!t.repeat) return t.date;
  const from = c.date > t.date ? c.date : t.date;
  for (let i = 0; i < 400; i++) {
    const d = addDays(from, i);
    if (occursOn(t, d)) return d;
  }
  return t.date;
}

function timeText(t: Task, s: Settings): string {
  if (t.type === 'planned') return `${fmt(t.start, s.clock)} – ${fmt(t.start + t.dur, s.clock)}`;
  return t.type === 'allday' ? 'All day' : 'To-do';
}

function detailText(t: Task, s: Settings): string {
  const tag = findTag(s.tags, t.tagId);
  const place = t.placeId ? s.places.find((p) => p.id === t.placeId) : null;
  return [tag ? tagLabel(tag) : null, place?.name ?? null].filter(Boolean).join(' · ');
}

// Subtasks still open for the occurrence a reminder belongs to (repeating
// tasks tick them off per day). While any are, a reminder offers "Open" instead
// of "Done" — a task only completes once its subtasks are.
function openSubs(t: Task, date: string | null): number {
  if (t.repeat && date) {
    const ticked = t.subDone?.[date] ?? [];
    return t.subtasks.filter((x) => !ticked.includes(x.id)).length;
  }
  return t.subtasks.filter((x) => !x.done).length;
}

export function toNative(t: Task, f: Fire, s: Settings): NativeReminder {
  return {
    subsLeft: openSubs(t, f.date),
    id: f.id,
    taskKey: f.taskKey,
    date: f.date,
    at: f.at,
    wall: wallOf(f.at),
    intensity: t.reminders?.intensity ?? 'easy',
    kind: f.kind,
    title: shownTitle(t),
    emoji: t.emoji,
    color: t.color,
    startAt: f.startAt,
    endAt: f.endAt,
    timeText: timeText(t, s),
    detail: detailText(t, s),
  };
}

/** Every reminder that will fire in the next HORIZON_DAYS, soonest first. */
export function buildSchedule(tasks: Task[], s: Settings, now = Date.now()): NativeReminder[] {
  if (!s.remindersOn) return [];
  const from = now + 1000;
  const to = now + HORIZON_DAYS * DAY;
  const all: NativeReminder[] = [];
  for (const t of tasks) {
    if (!hasReminders(t.reminders)) continue;
    for (const f of taskFires(t, s, from, to)) all.push(toNative(t, f, s));
  }
  all.sort((a, b) => a.at - b.at);
  return all.slice(0, MAX_SCHEDULED);
}

/** The task occurrences that may still remind — a snooze of anything else is dropped. */
export function liveKeys(tasks: Task[], s: Settings, now = Date.now()): string[] {
  if (!s.remindersOn) return [];
  const out: string[] = [];
  const first = dateKey(new Date(now - 2 * DAY));
  for (const t of tasks) {
    if (!hasReminders(t.reminders)) continue;
    if (!t.repeat) {
      if (!t.done) out.push(t.id);
      continue;
    }
    for (let i = 0; i < HORIZON_DAYS + 4; i++) {
      const d = addDays(first, i);
      if (occursOn(t, d) && !t.doneDates.includes(d)) out.push(instanceId(t.id, d));
    }
  }
  return out;
}

export function nativeConfig(s: Settings): NativeConfig {
  return {
    enabled: s.remindersOn,
    snoozeMin: s.snoozeMin,
    ringMin: s.ringMin,
    sound: s.alarmSound?.uri ?? null,
    soundName: s.alarmSound?.name ?? null,
    vibrate: s.alarmVibrate,
    gentle: s.alarmGentle,
    clock24: s.clock === '24h',
    animScale: s.animations ? 1 / s.animSpeed : 0, // the native screen scales durations
    snoozeButton: s.alarmSnoozeBtn,
    doneButton: s.alarmDoneBtn,
  };
}

// ---- Labels ----------------------------------------------------------------

export function beforeLabel(min: number, type: TaskType = 'planned'): string {
  const edge = type === 'allday' ? 'the day starts' : 'start';
  return min === 0 ? (type === 'allday' ? 'When the day starts' : 'At start') : `${fmtOffset(min)} before ${edge}`;
}
export function afterLabel(min: number, type: TaskType = 'planned'): string {
  const edge = type === 'allday' ? 'the day ends' : 'end';
  return min === 0 ? (type === 'allday' ? 'When the day ends' : 'At end') : `${fmtOffset(min)} after ${edge}`;
}

/** "Tomorrow · 09:00" */
export function customLabel(c: CustomReminder, clock: Clock): string {
  return `${dateLabel(c.date)} · ${fmt(c.min, clock)}`;
}

/** Short phrases for the editor row, e.g. ["10 min before", "At end", "Tomorrow 09:00"]. */
export function reminderSummary(r: Reminders | null, type: TaskType, clock: Clock): string[] {
  if (!hasReminders(r)) return [];
  const out: string[] = [];
  if (hasTime(type)) {
    if (r.before != null) out.push(r.before === 0 ? 'At start' : `${fmtOffset(r.before)} before`);
    if (r.after != null) out.push(r.after === 0 ? 'At end' : `${fmtOffset(r.after)} after`);
  }
  if (r.custom.length === 1) out.push(`${dateLabel(r.custom[0].date)} ${fmt(r.custom[0].min, clock)}`);
  else if (r.custom.length > 1) out.push(`${r.custom.length} custom`);
  return out;
}

/** Does this task actually have something that can fire (to-dos ignore before / after)? */
export function remindsAtAll(t: Pick<Task, 'type' | 'reminders'>): boolean {
  const r = t.reminders;
  if (!hasReminders(r)) return false;
  return r.custom.length > 0 || (hasTime(t.type) && (r.before != null || r.after != null));
}

// A task's reminders as rows for the info sheet — for one occurrence (`date`).
export type ReminderLine = { key: string; kind: 'before' | 'after' | 'custom'; label: string; at: number | null; past: boolean };
export function reminderLines(t: Task, date: string | null, s: Settings, now = Date.now()): ReminderLine[] {
  const r = t.reminders;
  if (!hasReminders(r)) return [];
  const out: ReminderLine[] = [];
  const win = taskWindow(t, s);
  if (win && date) {
    if (r.before != null) {
      const at = localMs(date, win.start - r.before);
      out.push({ key: 'before', kind: 'before', label: beforeLabel(r.before, t.type), at, past: at <= now });
    }
    if (r.after != null) {
      const at = localMs(date, win.end + r.after);
      out.push({ key: 'after', kind: 'after', label: afterLabel(r.after, t.type), at, past: at <= now });
    }
  }
  for (const c of [...r.custom].sort((a, b) => localMs(a.date, a.min) - localMs(b.date, b.min))) {
    const at = localMs(c.date, c.min);
    out.push({ key: c.id, kind: 'custom', label: dateLabel(c.date), at, past: at <= now });
  }
  return out;
}

/** The next custom reminder still ahead (to-do rows show it). */
export function nextCustom(r: Reminders | null, now = Date.now()): CustomReminder | null {
  if (!r) return null;
  let best: CustomReminder | null = null;
  for (const c of r.custom) {
    const at = localMs(c.date, c.min);
    if (at > now && (!best || at < localMs(best.date, best.min))) best = c;
  }
  return best;
}

/** "in 5 min" / "in 2 h" / "in 3 days" */
export function fromNow(at: number, now = Date.now()): string {
  const m = Math.round((at - now) / 60000);
  if (m <= 0) return 'now';
  if (m < 60) return `in ${m} min`;
  const h = Math.round(m / 60);
  if (h < 36) return `in ${h} h`;
  return `in ${Math.round(h / 24)} days`;
}

/** Day + time for a moment: "Today 09:00". */
export function whenLabel(at: number, clock: Clock): string {
  const d = new Date(at);
  return `${dateLabel(dateKey(d))} ${fmt(d.getHours() * 60 + d.getMinutes(), clock)}`;
}

/** A fresh custom reminder: the task's day an hour before it starts, or the next round hour. */
export function newCustom(d: Pick<Draft, 'type' | 'date' | 'start'>, s: Settings, now = Date.now()): CustomReminder {
  const cand = d.type !== 'todo' && d.date ? { date: d.date, min: Math.max(0, (d.type === 'planned' ? d.start : s.dayStart) - 60) } : null;
  if (cand && localMs(cand.date, cand.min) > now + 5 * 60000) return { id: genId(), ...cand };
  const x = new Date(now + 60 * 60000);
  x.setMinutes(x.getMinutes() < 30 ? 0 : 30, 0, 0);
  if (x.getTime() <= now) x.setMinutes(x.getMinutes() + 30);
  return { id: genId(), date: dateKey(x), min: x.getHours() * 60 + x.getMinutes() };
}

// ---- Keeping the native schedule in sync ------------------------------------

/**
 * Keeps the native alarms matching the tasks: re-syncs (debounced) on every
 * change and whenever the app comes back to the foreground, and applies what
 * was done from a notification or the alarm screen ("Done").
 */
export function useReminderSync(opts: { loaded: boolean; tasks: Task[]; settings: Settings; onDone: (taskKey: string) => void }) {
  const { loaded, tasks, settings, onDone } = opts;
  const latest = useRef({ tasks, settings, onDone });
  latest.current = { tasks, settings, onDone };
  const push = () => {
    const { tasks: ts, settings: st } = latest.current;
    const now = Date.now();
    Native.sync(buildSchedule(ts, st, now), liveKeys(ts, st, now), nativeConfig(st));
  };

  useEffect(() => {
    if (!loaded || !Native.available) return;
    const t = setTimeout(push, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, tasks, settings]);

  useEffect(() => {
    if (!loaded || !Native.available) return;
    let busy = false;
    const drain = async () => {
      if (busy) return;
      busy = true;
      try {
        const acts = await Native.takeActions();
        for (const a of acts) if (a.type === 'done') latest.current.onDone(a.taskKey);
      } finally {
        busy = false;
      }
    };
    drain();
    const off = Native.addActionListener(() => drain());
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') return;
      drain();
      push(); // the horizon moved on
    });
    return () => {
      off();
      sub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);
}
