import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Cal from '../modules/calendar';
import type { CalEvent, CalInstance, DeviceCalendar, EventInput } from '../modules/calendar';
import { occursOn } from './recurrence';
import { localMs } from './reminders';
import { EMOJIS } from './theme';
import { CalendarSync, CalExtra, CalLink, CalSeen, Place, Repeat, RepeatFreq, Settings, Task } from './types';
import { addDays, dateFromKey, dateKey, genId } from './utils';

// ---------------------------------------------------------------------------
// Calendar sync — tasks ⇄ calendars on the phone (a Google account's
// calendars reach Google through the phone's own account sync). Several can
// sync at once: each is synced on its own (below), new tasks go to the main
// one, and a task brought in from any of them goes back to the one it's from.
//
//  • A synced task carries a link (Task.cal) to its event: the event's id and
//    fingerprints of both sides as of the last sync, so each sync can tell
//    which side changed. Fingerprints compare what an event *means* (title,
//    day, time, length, notes, rule), never its raw text, so a server
//    reformatting a rule can't start a tug of war.
//  • Tasks sent to the calendar are whole events (a repeating task is one
//    recurring event with its rule). Events brought in are single events, or
//    — for a recurring event — one task per occurrence, so an occurrence moved
//    or cancelled in the calendar is always shown right.
//  • Both ways: the side that changed wins (the task, when both did).
//    Tasks → Calendar: the calendar mirrors the tasks. Calendar → Tasks:
//    tasks follow the calendar; nothing is written to it.
//  • Deletions: an event deleted in the calendar removes its task; a task
//    deleted here removes its event (both ways / tasks → calendar) or keeps it
//    from coming back (calendar → tasks). A sync that would remove many tasks
//    at once stops and asks first.
// ---------------------------------------------------------------------------

const DAY = 86400000;
/** The icon of tasks brought in from the calendar (never written into titles). */
export const CAL_EMOJI = '📅';
/** Events come in from this many days back … */
export const PAST_DAYS = 14;
/** … to this many ahead. */
export const AHEAD_DAYS = 120;
const MASS = 5; // removing at least this many tasks at once (and most of the synced ones) needs a confirmation

export type SyncOps = {
  create: Task[];
  update: { id: string; expect: string; fields: Partial<Task> }[]; // applied only while the task still looks as it did (`expect`)
  link: { id: string; cal: CalLink | undefined }[]; // always applied (a new event id must never be lost)
  remove: { id: string; expect: string }[];
};

export type SyncOutcome = {
  ops: SyncOps;
  patch: Partial<CalendarSync>;
  changes: { toCalendar: number; fromCalendar: number; removed: number };
  // Set when a calendar's sync stopped before removing many tasks (see MASS).
  held?: { count: number; titles: string[]; cal: string };
};

export const EMPTY_OPS: SyncOps = { create: [], update: [], link: [], remove: [] };
export const hasOps = (o: SyncOps) => o.create.length + o.update.length + o.link.length + o.remove.length > 0;

// ---- Fingerprints ------------------------------------------------------------

function hash(s: string): string {
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619);
    b = Math.imul(b ^ c, 2246822507);
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}

// Everything the calendar sees of a task / an event, reduced to its meaning.
type Face = { title: string; notes: string; allDay: boolean; date: string; start: number; dur: number; x: number; days: number; repeat: string; skip?: string };
const faceHash = (f: Face) => hash(JSON.stringify(f));

const RDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

const utcKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const utcMs = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

// A rule's meaning, from the day it starts on.
function repeatKey(r: Repeat | null, first: string): string {
  if (!r) return '';
  const F = dateFromKey(first);
  const wd = r.freq === 'weekly' ? (r.weekdays.length ? [...r.weekdays].sort((a, b) => a - b) : [F.getDay()]).join('') : '';
  return [r.freq, Math.max(1, r.interval), wd, r.freq === 'monthly' ? r.monthlyMode : '', r.endDate ?? ''].join('|');
}

/** The first day a repeating task actually occurs on (its base day may not match its rule). */
export function firstOccurrence(t: Pick<Task, 'date' | 'repeat' | 'type'>): string {
  if (!t.repeat || !t.date) return t.date!;
  for (let i = 0; i < 800; i++) {
    const d = addDays(t.date, i);
    if (t.repeat.endDate && d > t.repeat.endDate) break;
    if (occursOn(t as Task, d)) return d;
  }
  return t.date;
}

// A multi-day all-day event brought in: the task repeats daily through the
// event's last day. Returns its length in days (0 = not one).
function spanDays(t: Task, lk?: CalLink | null): number {
  const r = t.repeat;
  if (!lk?.span || t.type !== 'allday' || !r || r.freq !== 'daily' || r.interval !== 1 || !r.endDate || !t.date) return 0;
  return Math.max(1, Math.round((utcMs(r.endDate) - utcMs(t.date)) / DAY) + 1);
}

const EMOJI_ANY = /[\u2190-\u2BFF\u3030\u303D\u3297\u3299]|[\uD83C-\uD83E][\uDC00-\uDFFF]/;
let EMOJI_LEAD: RegExp | null = null;
try {
  EMOJI_LEAD = new RegExp('^(\\p{Extended_Pictographic}(?:\\uFE0F|\\u20E3|[\\u{1F3FB}-\\u{1F3FF}]|\\u200D\\p{Extended_Pictographic})*\\uFE0F?)\\s+(\\S[\\s\\S]*)$', 'u');
} catch {
  EMOJI_LEAD = null; // no Unicode property escapes — the known icons still work
}

/** An event's title for a task: its icon in front (tasks brought in keep the calendar's own titles). */
export function eventTitle(t: Pick<Task, 'emoji' | 'title'>): string {
  const e = (t.emoji || '').trim();
  return e && e !== CAL_EMOJI && EMOJI_ANY.test(e) ? `${e} ${t.title}` : t.title;
}

/** An event title split into a leading icon and the rest. */
function splitTitle(raw: string, known: string[]): { emoji: string | null; title: string } {
  const s = raw.trim();
  for (const e of known) if (e && s.length > e.length + 1 && s.startsWith(e + ' ')) return { emoji: e, title: s.slice(e.length + 1).trim() };
  const m = EMOJI_LEAD?.exec(s);
  return m ? { emoji: m[1], title: m[2].trim() } : { emoji: null, title: s };
}

// Calendar descriptions may be HTML (Google's editor) — plain text for notes.
function htmlToText(s: string): string {
  if (!/<[a-zA-Z/!][^>]*>|&[a-z#0-9]+;/.test(s)) return s.trim();
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[a-zA-Z/!][^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// An event's day, time and length the way a task holds them. A timed event
// running past midnight stops there (x = the minutes cut off).
function pieceOf(s: number, e: number, allDay: boolean) {
  if (allDay) return { date: utcKey(s), start: 0, dur: 0, x: 0, days: Math.max(1, Math.round((e - s) / DAY)) };
  const d = new Date(s);
  const start = d.getHours() * 60 + d.getMinutes();
  const total = Math.max(0, Math.round((e - s) / 60000));
  const room = 24 * 60 - start;
  return { date: dateKey(d), start, dur: Math.max(5, Math.min(total, room)), x: total > room ? total - room : 0, days: 0 };
}

function parseDuration(d: string | null, allDay: boolean): number {
  // (Android writes "P3600S" — seconds without the "T" — so it's optional)
  const m = d ? /^[+]?P(?:(\d+)W)?(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d.trim().toUpperCase()) : null;
  if (!m) return allDay ? DAY : 3600000;
  return (+(m[1] || 0) * 7 + +(m[2] || 0)) * DAY + +(m[3] || 0) * 3600000 + +(m[4] || 0) * 60000 + +(m[5] || 0) * 1000;
}

function faceOfTask(t: Task, lk?: CalLink | null): Face {
  const allDay = t.type === 'allday';
  const span = spanDays(t, lk);
  const first = t.repeat && !span ? firstOccurrence(t) : t.date!;
  return {
    title: eventTitle(t).trim(),
    notes: t.notes.trim(),
    allDay,
    date: first,
    start: allDay ? 0 : t.start,
    dur: allDay ? 0 : t.dur,
    x: allDay ? 0 : (lk?.x ?? 0),
    days: allDay ? span || 1 : 0,
    repeat: span ? '' : repeatKey(t.repeat, first),
    // (only there when some are — every other task's fingerprint stays as it was)
    ...(t.repeat && !span && t.skip?.length ? { skip: [...t.skip].sort().join(',') } : {}),
  };
}

function faceOfEvent(ev: CalEvent): Face {
  const end = ev.end ?? ev.start + parseDuration(ev.duration, ev.allDay);
  const p = pieceOf(ev.start, end, ev.allDay);
  const rule = ev.rrule ? fromRRule(ev.rrule, p.date, ev.allDay) : null;
  return {
    title: ev.title.trim(),
    notes: htmlToText(ev.description),
    allDay: ev.allDay,
    date: p.date,
    start: p.start,
    dur: p.dur,
    x: p.x,
    days: ev.allDay ? (ev.rrule ? 1 : p.days) : 0,
    repeat: ev.rrule ? (rule ? repeatKey(rule, p.date) : `?${ev.rrule}`) : '',
  };
}

function faceOfInstance(i: CalInstance): Face {
  const p = pieceOf(i.begin, i.end, i.allDay);
  return { title: i.title.trim(), notes: htmlToText(i.description), allDay: i.allDay, date: p.date, start: p.start, dur: p.dur, x: p.x, days: i.allDay ? p.days : 0, repeat: '' };
}

/** A task's calendar fingerprint (what `expect` compares against). */
export const taskFace = (t: Task) => faceHash(faceOfTask(t, t.cal));

// ---- Recurrence rules (RFC 5545) ---------------------------------------------

function toRRule(r: Repeat, base: string, allDay: boolean): string {
  const B = dateFromKey(base);
  const p = [`FREQ=${r.freq.toUpperCase()}`];
  const n = Math.max(1, r.interval);
  if (n > 1) p.push(`INTERVAL=${n}`);
  if (r.freq === 'weekly') {
    const days = (r.weekdays.length ? [...r.weekdays] : [B.getDay()]).sort((a, b) => a - b);
    p.push(`BYDAY=${days.map((d) => RDAY[d]).join(',')}`, 'WKST=SU'); // weeks counted from Sunday, like the app
  } else if (r.freq === 'monthly') {
    p.push(r.monthlyMode === 'weekday' ? `BYDAY=${Math.ceil(B.getDate() / 7)}${RDAY[B.getDay()]}` : `BYMONTHDAY=${B.getDate()}`);
  }
  if (r.endDate) {
    // All-day: the last day itself; timed: the end of that day, in UTC.
    p.push(
      `UNTIL=${
        allDay
          ? r.endDate.replace(/-/g, '')
          : new Date(localMs(r.endDate, 24 * 60) - 1000)
              .toISOString()
              .replace(/[-:]/g, '')
              .replace(/\.\d{3}/, '')
      }`
    );
  }
  return p.join(';');
}

const FREQS: Record<string, RepeatFreq | undefined> = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' };

// A rule the app can show, or null when it can't (e.g. "every 2nd and 4th
// Monday") — such events are never re-shaped from here.
function fromRRule(rule: string, first: string, allDay: boolean): Repeat | null {
  const kv: Record<string, string> = {};
  for (const part of rule.replace(/^RRULE:/i, '').split(';')) {
    const [k, v] = part.split('=');
    if (k && v != null) kv[k.trim().toUpperCase()] = v.trim().toUpperCase();
  }
  const freq = FREQS[kv.FREQ];
  if (!freq) return null;
  const interval = kv.INTERVAL ? parseInt(kv.INTERVAL, 10) : 1;
  if (!(interval >= 1)) return null;
  const allowed = new Set(['FREQ', 'INTERVAL', 'UNTIL', 'COUNT', 'WKST', 'BYDAY', 'BYMONTHDAY', 'BYMONTH']);
  if (Object.keys(kv).some((k) => !allowed.has(k))) return null;
  const F = dateFromKey(first);
  const byday = kv.BYDAY ? kv.BYDAY.split(',').filter(Boolean) : [];
  const r: Repeat = { freq, interval, weekdays: [], monthlyMode: 'date', endDate: null };
  if (kv.BYMONTH && !(freq === 'yearly' && +kv.BYMONTH === F.getMonth() + 1)) return null;
  if (kv.BYMONTHDAY && !((freq === 'monthly' || freq === 'yearly') && +kv.BYMONTHDAY === F.getDate())) return null;
  if (freq === 'daily' || freq === 'yearly') {
    if (byday.length) return null;
  } else if (freq === 'weekly') {
    const days = byday.map((d) => RDAY.indexOf(d));
    if (days.some((d) => d < 0)) return null;
    const wk = [...new Set(days.length ? days : [F.getDay()])].sort((a, b) => a - b);
    // The app counts weeks from Sunday; a rule counting them from Monday only differs with Sunday among several days.
    if (interval > 1 && (kv.WKST ?? 'MO') !== 'SU' && wk.includes(0) && wk.length > 1) return null;
    r.weekdays = wk;
  } else {
    if (byday.length) {
      const m = byday.length === 1 && !kv.BYMONTHDAY ? /^\+?([1-5])(SU|MO|TU|WE|TH|FR|SA)$/.exec(byday[0]) : null;
      if (!m || RDAY.indexOf(m[2]) !== F.getDay() || +m[1] !== Math.ceil(F.getDate() / 7)) return null;
      r.monthlyMode = 'weekday';
    }
  }
  if (kv.UNTIL) {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(kv.UNTIL);
    if (!m) return null;
    r.endDate = !m[4] || allDay || !m[7] ? `${m[1]}-${m[2]}-${m[3]}` : dateKey(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])));
  } else if (kv.COUNT) {
    const n = parseInt(kv.COUNT, 10);
    const probe = { date: first, repeat: r, type: 'planned' } as Task;
    let seen = 0;
    for (let i = 0; i < 3700 && n >= 1; i++) {
      const d = addDays(first, i);
      if (occursOn(probe, d) && ++seen === n) {
        r.endDate = d;
        break;
      }
    }
    if (!r.endDate) return null;
  }
  return r;
}

// ---- Tasks ⇄ events ------------------------------------------------------------

const appUri = (t: Task) => `operarius://task?key=${encodeURIComponent(t.id)}`;
function taskIdOf(uri: string | null): string | null {
  const m = uri ? /[?&]key=([^&]+)/.exec(uri) : null;
  return m ? decodeURIComponent(m[1]) : null;
}

// The days taken out of a repeating task, as the event's EXDATE (one per line,
// as the phone writes them): each occurrence's start in UTC, or its day
// (all-day). null when there are none — the event's own is then left alone.
function exdates(t: Task): string | null {
  if (!t.repeat || !t.skip?.length) return null;
  const stamp = (d: string) => (t.type === 'allday' ? d.replace(/-/g, '') : new Date(localMs(d, t.start)).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''));
  return [...t.skip].sort().map(stamp).join('\n');
}

// The event a task is written as.
function eventOf(t: Task, lk?: CalLink | null, own = true): EventInput {
  const title = eventTitle(t);
  const description = t.notes;
  const uri = own ? appUri(t) : null;
  if (t.type === 'allday') {
    const span = spanDays(t, lk);
    const first = t.repeat && !span ? firstOccurrence(t) : t.date!;
    const s = utcMs(first);
    const rrule = t.repeat && !span ? toRRule(t.repeat, t.date!, true) : null;
    return { title, description, start: s, end: s + (span || 1) * DAY, allDay: true, timeZone: 'UTC', rrule, exdate: rrule ? exdates(t) : null, appUri: uri };
  }
  const first = t.repeat ? firstOccurrence(t) : t.date!;
  const s = localMs(first, t.start);
  const rrule = t.repeat ? toRRule(t.repeat, t.date!, false) : null;
  return { title, description, start: s, end: localMs(first, t.start + t.dur + (lk?.x ?? 0)), allDay: false, timeZone: '', rrule, exdate: rrule ? exdates(t) : null, appUri: uri };
}

// What a task is read from: an event, or one occurrence of one.
type Src = { title: string; description: string; start: number; end: number; allDay: boolean; rrule: string | null };

// A task's calendar fields from an event (or one occurrence of one).
function fieldsOf(src: Src, cur: Task | null, known: string[]): { fields: Partial<Task>; span: boolean; x: number } {
  const p = pieceOf(src.start, src.end, src.allDay);
  const { emoji, title } = splitTitle(src.title, cur ? [cur.emoji, ...known] : known);
  const fields: Partial<Task> = { title: title || 'Untitled', notes: htmlToText(src.description), type: src.allDay ? 'allday' : 'planned', date: p.date };
  if (emoji) fields.emoji = emoji;
  if (!src.allDay) {
    fields.start = p.start;
    fields.dur = p.dur;
  }
  let span = false;
  if (src.rrule)
    fields.repeat = fromRRule(src.rrule, p.date, src.allDay) ?? cur?.repeat ?? null; // a rule the app can't show leaves the task's own
  else if (src.allDay && p.days > 1) {
    fields.repeat = { freq: 'daily', interval: 1, weekdays: [], monthlyMode: 'date', endDate: addDays(p.date, p.days - 1) };
    span = true;
  } else fields.repeat = null;
  return { fields, span, x: src.allDay ? 0 : p.x };
}

const evSrc = (ev: CalEvent): Src => ({
  title: ev.title,
  description: ev.description,
  start: ev.start,
  end: ev.end ?? ev.start + parseDuration(ev.duration, ev.allDay),
  allDay: ev.allDay,
  rrule: ev.rrule,
});
const instSrc = (i: CalInstance): Src => ({ title: i.title, description: i.description, start: i.begin, end: i.end, allDay: i.allDay, rrule: null });

function newTask(fields: Partial<Task>, color: string, placeId: string | null, cal: CalLink): Task {
  return {
    id: genId(),
    title: 'Untitled',
    emoji: CAL_EMOJI,
    color,
    type: 'planned',
    start: 9 * 60,
    dur: 30,
    done: false,
    tagId: null,
    placeId,
    date: null,
    notes: '',
    subtasks: [],
    repeat: null,
    doneDates: [],
    expanded: false,
    reminders: null, // the calendar reminds of its own events
    ...fields,
    cal,
  };
}

function placeFor(places: Place[], location: string): string | null {
  const l = location.trim().toLowerCase();
  if (!l) return null;
  return places.find((p) => p.name.trim().toLowerCase() === l || (p.address && p.address.trim().toLowerCase() === l))?.id ?? null;
}

// ---- One sync ------------------------------------------------------------------

// Remote-only changes pushed back (tasks → calendar mirrors them): a server that
// keeps rewriting an event must not keep us rewriting it back.
const recentPushes = new Map<string, number[]>();
function pushBudget(id: string, now: number): boolean {
  const list = (recentPushes.get(id) ?? []).filter((t) => now - t < 10 * 60000);
  if (list.length >= 3) return false;
  recentPushes.set(id, [...list, now]);
  return true;
}

export class SyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncError';
  }
}

type SyncOpts = { mass?: 'ask' | 'remove' | 'keep'; now?: number };

// One calendar of a sync: the main one (new tasks are written to it) or another.
type OneCal = { id: string; main: boolean; seen: CalSeen[]; ignored: string[] };
type OneOutcome = {
  ops: SyncOps;
  state: Pick<CalExtra, 'seen' | 'ignored' | 'counts'>;
  changes: SyncOutcome['changes'];
  held?: { count: number; titles: string[] };
};

/**
 * Brings `tasks` and the synced calendars in step, per the chosen direction.
 * Writes to the calendars directly; changes to the tasks come back as `ops`
 * (applied by the caller onto the then-current tasks). `mass`: what to do when
 * many tasks would be removed at once ('ask' stops that calendar and reports them).
 */
export async function runCalendarSync(tasks: Task[], settings: Settings, opts: SyncOpts = {}): Promise<SyncOutcome> {
  const cfg = settings.calendar;
  if (!cfg.calendarId) throw new SyncError('Pick a calendar to sync with');
  if ((await Cal.permission()) !== 'granted') throw new SyncError('Operarius isn’t allowed to use your calendar');
  const list = await Cal.calendars();
  const main = list.find((c) => c.id === cfg.calendarId);
  if (!main) throw new SyncError(`“${cfg.calendarName || 'The calendar'}” is no longer on this phone`);

  // The other calendars first: a task restored from a backup that came from one
  // of them is matched to its event there, before the main calendar would take
  // it for a new task.
  const extras = cfg.extra.filter((e) => e.id !== main.id);
  const ones: OneCal[] = [...extras.map((e) => ({ id: e.id, main: false, seen: e.seen, ignored: e.ignored })), { id: main.id, main: true, seen: cfg.seen, ignored: cfg.ignored }];
  // (a calendar that's gone missing for now keeps its tasks' links)
  const synced = new Set(ones.map((o) => o.id));

  let cur = tasks;
  const ops: SyncOps = { create: [], update: [], link: [], remove: [] };
  const changes = { toCalendar: 0, fromCalendar: 0, removed: 0 };
  let held: SyncOutcome['held'];
  const extra: CalExtra[] = [];
  let mainState: Partial<CalendarSync> = {};
  for (const one of ones) {
    const kept = extras.find((e) => e.id === one.id);
    const target = list.find((c) => c.id === one.id);
    if (!target) {
      if (kept) extra.push(kept);
      continue;
    }
    const r = await syncOne(cur, settings, one, target, synced, opts);
    if (r.held) {
      held ??= { ...r.held, cal: target.name };
      if (kept) extra.push(kept);
      continue;
    }
    ops.create.push(...r.ops.create);
    ops.update.push(...r.ops.update);
    ops.link.push(...r.ops.link);
    ops.remove.push(...r.ops.remove);
    cur = applyOps(cur, r.ops);
    changes.toCalendar += r.changes.toCalendar;
    changes.fromCalendar += r.changes.fromCalendar;
    changes.removed += r.changes.removed;
    const about = { name: target.name, account: target.account, color: target.color };
    if (one.main) mainState = { ...r.state, calendarName: about.name, account: about.account, color: about.color };
    else extra.push({ ...kept!, ...r.state, ...about });
  }
  return { ops, patch: { lastSync: opts.now ?? Date.now(), lastError: null, ...mainState, extra }, changes, ...(held ? { held } : {}) };
}

/** Brings `tasks` and one calendar in step (see runCalendarSync). */
async function syncOne(tasks: Task[], settings: Settings, one: OneCal, target: DeviceCalendar, synced: Set<string>, opts: SyncOpts): Promise<OneOutcome> {
  const cfg = settings.calendar;
  const cal = one.id;
  const now = opts.now ?? Date.now();
  const mass = opts.mass ?? 'ask';
  const dir = cfg.direction;
  const write = dir !== 'fromCalendar' && target.writable;
  const read = dir !== 'toCalendar';
  const today = dateKey(new Date(now));
  const winFrom = addDays(today, -PAST_DAYS);
  const winTo = addDays(today, AHEAD_DAYS);
  const inWin = (d: string | null) => !!d && d >= winFrom && d <= winTo;
  const known = [...new Set([...settings.emojis, ...EMOJIS])].filter((e) => EMOJI_ANY.test(e));
  const ops: SyncOps = { create: [], update: [], link: [], remove: [] };
  const changes = { toCalendar: 0, fromCalendar: 0, removed: 0 };
  const ignored = new Set(one.ignored);
  const keptSeen: CalSeen[] = []; // deletions still to be carried out (kept for the next sync)

  const syncable = (t: Task) => t.type !== 'todo' && !!t.date;
  const byId = new Map(tasks.map((t) => [t.id, t]));

  // Links on this calendar. A task that can no longer be an event (e.g. turned
  // into a to-do) drops its link — it then counts as deleted here; so do links
  // to a calendar no longer synced (dropped once, by the main calendar's sync).
  // Links to the other synced calendars are theirs.
  const linked: Task[] = [];
  for (const t of tasks) {
    if (!t.cal) continue;
    if (t.cal.c === cal) {
      if (syncable(t)) linked.push(t);
      else ops.link.push({ id: t.id, cal: undefined });
    } else if (one.main && !synced.has(t.cal.c)) ops.link.push({ id: t.id, cal: undefined });
  }
  const linkKeys = new Set(linked.map((t) => t.cal!.key));
  const goneHere = one.seen.filter((s) => !linkKeys.has(s.k));
  const goneKeys = new Set(goneHere.map((s) => s.k));

  // Events that belong to linked tasks (or are being removed): their
  // occurrences are never taken for new events.
  const owned = new Set<string>();
  for (const t of linked) if (!t.cal!.master) owned.add(t.cal!.id);
  for (const s of goneHere) if (!s.m) owned.add(s.i);

  const insts = await Cal.instances(cal, localMs(winFrom, 0) - DAY, localMs(winTo, 0) + 2 * DAY);

  // Sort the calendar's occurrences: the app's own events, single events and
  // occurrences of recurring events.
  const appOwned = new Map<string, CalInstance>(); // event id → an occurrence
  const singles = new Map<string, CalInstance>(); // event id → its occurrence
  const occ = new Map<string, CalInstance>(); // "<event>@<day>" → the occurrence
  const occMaster = new Map<string, string>(); // key → recurring event id
  for (const i of insts) {
    if (owned.has(i.eventId) || (i.originalId && owned.has(i.originalId))) continue;
    if (i.appUri) {
      appOwned.set(i.originalId ?? i.eventId, i);
      continue;
    }
    const master = i.originalId ?? (i.rrule ? i.eventId : null);
    if (master) {
      const ob = i.originalBegin ?? i.begin;
      const key = `${master}@${i.allDay ? utcKey(ob) : dateKey(new Date(ob))}`;
      if (!occ.has(key)) {
        occ.set(key, i);
        occMaster.set(key, master);
      }
    } else singles.set(i.eventId, i);
  }

  // Unlinked tasks that already have an event: the app's own (marked with the
  // task), or one that matches exactly (e.g. after moving to a new phone) —
  // adopted instead of duplicated.
  const adopt = new Map<string, { t: Task; id: string; face?: string; own?: boolean; occ?: { key: string; master: string; ob: number } }>(); // task id → event
  const adoptedEvents = new Set<string>();
  const orphans: string[] = []; // the app's own events whose task is gone
  for (const [evId, i] of appOwned) {
    const tid = taskIdOf(i.appUri);
    const t = tid ? byId.get(tid) : undefined;
    if (t && syncable(t) && !t.cal && !adopt.has(t.id)) {
      adopt.set(t.id, { t, id: evId, own: true });
      adoptedEvents.add(evId);
    } else if (!t || !syncable(t) || (t.cal && (t.cal.c !== cal || t.cal.id !== evId))) orphans.push(evId); // (its task is now another event's)
  }
  const sigT = (t: Task) => {
    const f = faceOfTask(t);
    return [f.allDay, t.title.trim().toLowerCase(), f.date, f.start, f.dur, f.days, f.repeat].join('|');
  };
  const sigF = (f: Face) => [f.allDay, splitTitle(f.title, known).title.toLowerCase(), f.date, f.start, f.dur, f.days, f.repeat].join('|');
  const unlinked = tasks.filter((t) => !t.cal && syncable(t) && !adopt.has(t.id));
  if (unlinked.length && (singles.size || occ.size)) {
    const bySig = new Map<string, Task>();
    for (const t of unlinked) if (!bySig.has(sigT(t))) bySig.set(sigT(t), t);
    for (const [id, i] of singles) {
      const t = bySig.get(sigF(faceOfInstance(i)));
      if (t && !adopt.has(t.id)) {
        adopt.set(t.id, { t, id, face: faceHash(faceOfInstance(i)) });
        adoptedEvents.add(id);
        singles.delete(id);
        bySig.delete(sigT(t));
      }
    }
    // One-off tasks against single occurrences of recurring events (e.g. restored from a backup).
    for (const [key, i] of occ) {
      const t = bySig.get(sigF(faceOfInstance(i)));
      if (t && !t.repeat && !adopt.has(t.id)) {
        adopt.set(t.id, { t, id: i.eventId, face: faceHash(faceOfInstance(i)), occ: { key, master: occMaster.get(key)!, ob: i.originalBegin ?? i.begin } });
        occ.delete(key);
        bySig.delete(sigT(t));
      }
    }
    // Repeating tasks against the calendar's recurring events.
    const reps = unlinked.filter((t) => t.repeat && !adopt.has(t.id));
    if (reps.length) {
      const masters = [...new Set(occMaster.values())];
      for (const ev of await Cal.events(masters)) {
        if (!ev.rrule) continue;
        const f = faceOfEvent(ev);
        const t = bySig.get(sigF(f));
        if (t && t.repeat && !adopt.has(t.id)) {
          adopt.set(t.id, { t, id: ev.id, face: faceHash(f) });
          adoptedEvents.add(ev.id);
          bySig.delete(sigT(t));
        }
      }
      for (const [k, m] of occMaster) if (adoptedEvents.has(m)) occ.delete(k);
    }
  }

  // The events of linked tasks (and adopted ones), as they are now.
  const occLinked = linked.filter((t) => t.cal!.master);
  const evIds = [...linked.filter((t) => !t.cal!.master).map((t) => t.cal!.id), ...[...adopt.values()].filter((a) => !a.face).map((a) => a.id)];
  const evs = new Map((await Cal.events(evIds)).map((e) => [e.id, e]));
  // Occurrences missing from the range may have been moved out of it (they're
  // then exceptions of their recurring event).
  const lost = occLinked.filter((t) => !occ.has(t.cal!.key) && inWin(t.date));
  const movedTo = new Map<string, CalEvent>(); // "<event>@<original start>" → where it went
  if (lost.length) for (const e of await Cal.exceptions([...new Set(lost.map((t) => t.cal!.master!))])) movedTo.set(`${e.originalId}@${e.originalBegin}`, e);

  const updates: { t: Task; fields: Partial<Task>; lk: CalLink }[] = [];
  const removals: Task[] = [];
  const pushed = new Map<string, { t: Task; lk: CalLink; occ: boolean }>(); // written event id → its task (fingerprinted after)

  const pull = (t: Task, src: Src, lk: CalLink, rh: string) => {
    const { fields, span, x } = fieldsOf(src, t, known);
    const next = { ...t, ...fields };
    const nlk: CalLink = { ...lk, rh, ...(span ? { span: 1 as const } : {}), ...(x ? { x } : {}) };
    if (!span) delete nlk.span;
    if (!x) delete nlk.x;
    nlk.lh = faceHash(faceOfTask(next as Task, nlk));
    updates.push({ t, fields, lk: nlk });
    changes.fromCalendar++;
  };

  const writeEvent = async (t: Task, lk: CalLink | null): Promise<void> => {
    const input = eventOf(t, lk, !lk?.from);
    const id = await Cal.upsert(cal, lk?.id ?? null, input);
    const nlk: CalLink = lk ? { ...lk, id, key: lk.key === lk.id ? id : lk.key, lh: faceHash(faceOfTask(t, lk)) } : { key: id, id, c: cal, lh: faceHash(faceOfTask(t)), rh: '' };
    pushed.set(id, { t, lk: nlk, occ: false });
    changes.toCalendar++;
  };

  const writeOccurrence = async (t: Task, lk: CalLink): Promise<void> => {
    try {
      const id = await Cal.upsertOccurrence(lk.master!, lk.ob!, lk.id !== lk.master ? lk.id : null, eventOf(t, lk, false));
      pushed.set(id, { t, lk: { ...lk, id, lh: faceHash(faceOfTask(t, lk)) }, occ: true });
      changes.toCalendar++;
    } catch {
      // Its series is gone: the occurrence lives on as an event of its own.
      await writeEvent(t, null);
    }
  };

  // 1. Tasks linked to whole events.
  for (const t of linked) {
    const lk = t.cal!;
    if (lk.master) continue;
    const ev = evs.get(lk.id) ?? null;
    const lc = faceHash(faceOfTask(t, lk)) !== lk.lh;
    const eh = ev ? faceHash(faceOfEvent(ev)) : null;
    const rc = eh !== lk.rh;
    try {
      if (dir === 'both' && write) {
        if (lc) await writeEvent(t, lk);
        else if (!ev) removals.push(t);
        else if (rc) pull(t, evSrc(ev), lk, eh!);
      } else if (dir === 'toCalendar') {
        if (write && (lc || (rc && pushBudget(t.id, now)))) await writeEvent(t, lk);
        else if (rc && ev) ops.link.push({ id: t.id, cal: { ...lk, rh: eh! } }); // accepted as it is
      } else {
        if (!ev) removals.push(t);
        else if (rc) pull(t, evSrc(ev), lk, eh!);
      }
    } catch {
      // Left for the next sync.
    }
  }

  // 2. Tasks linked to one occurrence of a recurring event.
  for (const t of occLinked) {
    const lk = t.cal!;
    const i = occ.get(lk.key);
    const lc = faceHash(faceOfTask(t, lk)) !== lk.lh;
    try {
      if (i) {
        occ.delete(lk.key);
        const cur: CalLink = { ...lk, id: i.eventId, ob: i.originalBegin ?? i.begin };
        const ih = faceHash(faceOfInstance(i));
        const rc = ih !== lk.rh;
        if (write && (lc || (dir === 'toCalendar' && rc && pushBudget(t.id, now)))) await writeOccurrence(t, cur);
        else if (read && rc) pull(t, instSrc(i), cur, ih);
        else if (cur.id !== lk.id || cur.ob !== lk.ob || (rc && !read)) ops.link.push({ id: t.id, cal: { ...cur, rh: ih } });
        continue;
      }
      if (!inWin(t.date)) continue; // out of range — left as it is
      const moved = movedTo.get(`${lk.master}@${lk.ob}`);
      if (moved) {
        // The occurrence was moved out of range: follow it.
        const cur: CalLink = { ...lk, id: moved.id };
        const eh = faceHash(faceOfEvent(moved));
        if (write && lc) await writeOccurrence(t, cur);
        else if (read && eh !== lk.rh) pull(t, evSrc(moved), cur, eh);
        else ops.link.push({ id: t.id, cal: cur });
        continue;
      }
      if (write && (dir === 'toCalendar' ? pushBudget(t.id, now) : lc)) await writeOccurrence(t, lk);
      else if (read) removals.push(t);
    } catch {
      // Left for the next sync.
    }
  }

  // 3. Adopted events: linked as they are.
  for (const a of adopt.values()) {
    let face = a.face;
    if (!face) {
      const ev = evs.get(a.id);
      if (!ev) continue;
      face = faceHash(faceOfEvent(ev));
    }
    // The app's own event: the task is written over it next time (it may have
    // changed since); an exact match is linked as it is.
    if (a.occ) ops.link.push({ id: a.t.id, cal: { key: a.occ.key, id: a.id, c: cal, lh: faceHash(faceOfTask(a.t)), rh: face, from: 1, master: a.occ.master, ob: a.occ.ob } });
    else ops.link.push({ id: a.t.id, cal: { key: a.id, id: a.id, c: cal, lh: a.own ? '' : faceHash(faceOfTask(a.t)), rh: face } });
  }

  // 4. Tasks deleted here (or turned into to-dos).
  for (const s of goneHere) {
    if (write) {
      try {
        if (s.m) await Cal.cancelOccurrence(s.m, s.o ?? 0, s.i !== s.m ? s.i : null);
        else await Cal.remove(s.i);
        changes.toCalendar++;
      } catch {
        keptSeen.push(s); // try again next time
      }
    } else if (read) {
      ignored.add(s.k);
      if (!s.m) ignored.add(s.i);
    } else keptSeen.push(s);
  }
  if (write) for (const id of orphans) await Cal.remove(id).catch(() => false);

  // 5. New events → new tasks.
  if (read) {
    for (const [id, i] of singles) {
      if (ignored.has(id) || goneKeys.has(id)) continue;
      const f = faceOfInstance(i);
      if (!inWin(f.date)) continue;
      const { fields, span, x } = fieldsOf(instSrc(i), null, known);
      const lk: CalLink = { key: id, id, c: cal, lh: '', rh: faceHash(f), from: 1, ...(span ? { span: 1 as const } : {}), ...(x ? { x } : {}) };
      const t = newTask(fields, i.color ?? target.color, placeFor(settings.places, i.location), lk);
      lk.lh = faceHash(faceOfTask(t, lk));
      ops.create.push(t);
      changes.fromCalendar++;
    }
    for (const [key, i] of occ) {
      const master = occMaster.get(key)!;
      if (ignored.has(key) || ignored.has(master) || goneKeys.has(key)) continue;
      const f = faceOfInstance(i);
      if (!inWin(f.date)) continue;
      const { fields, span, x } = fieldsOf(instSrc(i), null, known);
      const lk: CalLink = { key, id: i.eventId, c: cal, lh: '', rh: faceHash(f), from: 1, master, ob: i.originalBegin ?? i.begin, ...(span ? { span: 1 as const } : {}), ...(x ? { x } : {}) };
      const t = newTask(fields, i.color ?? target.color, placeFor(settings.places, i.location), lk);
      lk.lh = faceHash(faceOfTask(t, lk));
      ops.create.push(t);
      changes.fromCalendar++;
    }
  }

  // 6. New tasks → new events (from two weeks back on) — in the main calendar.
  if (write && one.main) {
    for (const t of tasks) {
      if (t.cal || !syncable(t) || adopt.has(t.id)) continue;
      if (t.repeat ? t.repeat.endDate && t.repeat.endDate < winFrom : t.date! < winFrom) continue;
      try {
        await writeEvent(t, null);
      } catch {
        // Left for the next sync.
      }
    }
  }

  // Fingerprint what was written, as the calendar stored it.
  if (pushed.size) {
    const stored = new Map((await Cal.events([...pushed.keys()])).map((e) => [e.id, e]));
    for (const [id, p] of pushed) {
      const ev = stored.get(id);
      ops.link.push({ id: p.t.id, cal: { ...p.lk, rh: ev ? faceHash(faceOfEvent(ev)) : p.lk.lh } });
    }
  }

  // Removals: many at once (and most of what's synced) waits for a yes.
  if (removals.length >= MASS && removals.length * 2 > linked.length && mass !== 'remove') {
    if (mass === 'ask') {
      return {
        ops: EMPTY_OPS,
        state: { seen: one.seen, ignored: one.ignored, counts: { toCalendar: 0, fromCalendar: 0 } },
        changes: { toCalendar: 0, fromCalendar: 0, removed: 0 },
        held: { count: removals.length, titles: removals.slice(0, 3).map((t) => t.title) },
      };
    }
    // 'keep': they stay as tasks here, no longer linked (never brought back).
    for (const t of removals) {
      ops.link.push({ id: t.id, cal: undefined });
      ignored.add(t.cal!.key);
      if (!t.cal!.master) ignored.add(t.cal!.id);
    }
  } else {
    for (const t of removals) {
      ops.remove.push({ id: t.id, expect: faceHash(faceOfTask(t, t.cal)) });
      changes.removed++;
    }
  }
  for (const u of updates) {
    ops.update.push({ id: u.t.id, expect: faceHash(faceOfTask(u.t, u.t.cal)), fields: u.fields });
    ops.link.push({ id: u.t.id, cal: u.lk });
  }

  // What's linked after this sync (to notice deletions next time).
  const finalLinks = new Map<string, CalLink | undefined>();
  for (const t of linked) finalLinks.set(t.id, t.cal);
  for (const l of ops.link) finalLinks.set(l.id, l.cal);
  for (const r of ops.remove) finalLinks.delete(r.id);
  const seen: CalSeen[] = [...keptSeen];
  let toCount = 0;
  let fromCount = 0;
  const add = (tid: string, lk: CalLink) => {
    if (lk.c !== cal) return;
    seen.push({ t: tid, k: lk.key, i: lk.id, ...(lk.master ? { m: lk.master, o: lk.ob } : {}), ...(lk.from ? { f: 1 as const } : {}) });
    if (lk.from) fromCount++;
    else toCount++;
  };
  for (const [tid, lk] of finalLinks) if (lk) add(tid, lk);
  for (const t of ops.create) add(t.id, t.cal!);

  const keepIgnored = [...ignored].slice(-2000); // (the oldest go first)

  return { ops, state: { seen, ignored: keepIgnored, counts: { toCalendar: toCount, fromCalendar: fromCount } }, changes };
}

/** Applies a sync's changes onto the current tasks (unchanged array when there are none). */
export function applyOps(prev: Task[], ops: SyncOps): Task[] {
  if (!hasOps(ops)) return prev;
  const upd = new Map(ops.update.map((u) => [u.id, u]));
  const lnk = new Map(ops.link.map((l) => [l.id, l.cal]));
  const rm = new Map(ops.remove.map((r) => [r.id, r.expect]));
  let changed = false;
  const out: Task[] = [];
  for (const t of prev) {
    const r = rm.get(t.id);
    if (r !== undefined && faceHash(faceOfTask(t, t.cal)) === r) {
      changed = true;
      continue;
    }
    let n = t;
    const u = upd.get(t.id);
    if (u && faceHash(faceOfTask(t, t.cal)) === u.expect) n = { ...n, ...u.fields };
    if (lnk.has(t.id)) {
      const c = lnk.get(t.id);
      if (c) n = { ...n, cal: c };
      else if (n.cal) {
        const { cal: _drop, ...rest } = n;
        n = rest as Task;
      }
    }
    if (n !== t) changed = true;
    out.push(n);
  }
  // New tasks, unless a task already carries that event (a sync raced another).
  const keys = new Set(out.map((t) => t.cal?.key).filter(Boolean));
  const fresh = ops.create.filter((t) => !keys.has(t.cal?.key));
  return changed || fresh.length ? [...out, ...fresh] : prev;
}

/** The synced calendars: the main one, then the others. */
export const syncedIds = (cfg: CalendarSync): string[] => (cfg.calendarId ? [cfg.calendarId, ...cfg.extra.map((e) => e.id).filter((id) => id !== cfg.calendarId)] : []);

/** The events the app itself put in those calendars (not their own, brought in as tasks). */
export function appEvents(tasks: Task[], calendarIds: string[]): Task[] {
  return tasks.filter((t) => t.cal && calendarIds.includes(t.cal.c) && !t.cal.from && !t.cal.master);
}

/** Removes them from the calendars (e.g. when all data is deleted). Resolves to how many went. */
export async function removeAppEvents(tasks: Task[], calendarIds: string[]): Promise<number> {
  let n = 0;
  for (const t of appEvents(tasks, calendarIds)) if (await Cal.remove(t.cal!.id).catch(() => false)) n++;
  return n;
}

/** Switching calendars (or no longer syncing one): the app's own events move along; tasks brought in from the old one go. */
export function planSwitch(tasks: Task[], oldCal: string | null): { moving: Task[]; leaving: Task[] } {
  const moving: Task[] = [];
  const leaving: Task[] = [];
  if (!oldCal) return { moving, leaving };
  for (const t of tasks) {
    if (!t.cal || t.cal.c !== oldCal) continue;
    if (t.cal.from) leaving.push(t);
    else moving.push(t);
  }
  return { moving, leaving };
}

export async function applySwitch(plan: { moving: Task[]; leaving: Task[] }, removeOld: boolean): Promise<SyncOps> {
  const ops: SyncOps = { create: [], update: [], link: [], remove: [] };
  for (const t of plan.moving) {
    if (removeOld) {
      if (t.cal!.master) await Cal.cancelOccurrence(t.cal!.master, t.cal!.ob ?? 0, t.cal!.id !== t.cal!.master ? t.cal!.id : null).catch(() => false);
      else await Cal.remove(t.cal!.id).catch(() => false);
    }
    ops.link.push({ id: t.id, cal: undefined });
  }
  for (const t of plan.leaving) ops.remove.push({ id: t.id, expect: taskFace(t) });
  return ops;
}

// ---- Keeping it running --------------------------------------------------------

type Status = { busy: boolean; held: SyncOutcome['held'] | null; last: SyncOutcome['changes'] | null };
let status: Status = { busy: false, held: null, last: null };
const listeners = new Set<(s: Status) => void>();
function setStatus(p: Partial<Status>) {
  status = { ...status, ...p };
  listeners.forEach((l) => l(status));
}
let runner: ((opts?: { mass?: 'remove' | 'keep'; refresh?: boolean }) => void) | null = null;

// While a change can still be undone (a deleted task), the calendar waits for it.
let holdUntil = 0;
export function holdCalendarSync(ms: number) {
  holdUntil = Math.max(holdUntil, Date.now() + ms);
}

/** Sync now (e.g. "Sync now", or answering a held removal). */
export function requestCalendarSync(opts?: { mass?: 'remove' | 'keep'; refresh?: boolean }) {
  runner?.(opts);
}

/** Whether a sync is running, and any removal waiting for a yes. */
export function useCalendarStatus(): Status {
  const [s, set] = useState(status);
  useEffect(() => {
    listeners.add(set);
    set(status);
    return () => {
      listeners.delete(set);
    };
  }, []);
  return s;
}

// A fingerprint of everything syncable, so edits that don't touch the calendar
// (ticking a task off, its subtasks, links written by a sync) don't sync.
function syncSig(tasks: Task[]): string {
  let s = '';
  for (const t of tasks)
    if (t.type !== 'todo' && t.date) s += `${t.id}:${faceHash(faceOfTask(t, t.cal))};`;
    else if (t.cal) s += `${t.id}:x;`;
  return hash(s);
}

/**
 * Keeps tasks and the calendar in step while sync is on: after changes here
 * (a few seconds later), whenever the calendar changes on the phone (another
 * app, or Google sending news), and when the app comes back to the front.
 */
export function useCalendarSync(opts: { loaded: boolean; tasks: Task[]; settings: Settings; apply: (ops: SyncOps, patch: Partial<CalendarSync>) => void }) {
  const { loaded, tasks, settings, apply } = opts;
  const latest = useRef({ tasks, settings, apply });
  latest.current = { tasks, settings, apply };
  const running = useRef(false);
  const held = useRef(false);
  const again = useRef<{ mass?: 'remove' | 'keep' } | null>(null);
  const sig = useRef<string | null>(null);
  const cfg = settings.calendar;
  const on = loaded && Cal.available && cfg.on && !!cfg.calendarId;
  const extraKey = cfg.extra.map((e) => e.id).join(',');

  const run = async (o: { mass?: 'remove' | 'keep'; refresh?: boolean } = {}) => {
    const { settings: s } = latest.current;
    if (!Cal.available || !s.calendar.on || !s.calendar.calendarId) return;
    const wait = holdUntil - Date.now();
    if (wait > 0) {
      if (!held.current) {
        held.current = true;
        setTimeout(() => {
          held.current = false;
          runRef.current(o);
        }, wait + 100);
      }
      return;
    }
    if (running.current) {
      again.current = { mass: o.mass ?? again.current?.mass };
      return;
    }
    running.current = true;
    setStatus({ busy: true });
    if (o.refresh) for (const id of syncedIds(s.calendar)) Cal.refresh(id);
    try {
      const { tasks: ts } = latest.current;
      sig.current = syncSig(ts);
      const res = await runCalendarSync(ts, latest.current.settings, { mass: o.mass ?? 'ask' });
      latest.current.apply(res.ops, res.patch);
      setStatus({ held: res.held ?? null, last: res.changes });
    } catch (e) {
      const msg = e instanceof SyncError ? e.message : 'Couldn’t reach the calendar — trying again soon';
      latest.current.apply(EMPTY_OPS, { lastError: msg });
    } finally {
      running.current = false;
      setStatus({ busy: false });
      if (again.current) {
        const next = again.current;
        again.current = null;
        setTimeout(() => run(next), 250);
      }
    }
  };
  const runRef = useRef(run);
  runRef.current = run;

  // Turned on, another calendar (or one more) or direction: sync now.
  useEffect(() => {
    if (!on) return;
    runRef.current({ refresh: true });
  }, [on, cfg.calendarId, cfg.direction, extraKey]);

  // Tasks changed here: sync a few seconds later (edits come in bursts).
  useEffect(() => {
    if (!on) return;
    const t = setTimeout(() => {
      if (syncSig(latest.current.tasks) !== sig.current) runRef.current();
    }, 4000);
    return () => clearTimeout(t);
  }, [on, tasks]);

  // The calendar changed on the phone, or the app came back to the front.
  useEffect(() => {
    if (!on) return;
    const off = Cal.watch(() => runRef.current());
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') runRef.current({ refresh: true });
    });
    runner = (o) => runRef.current(o);
    return () => {
      off();
      sub.remove();
      runner = null;
    };
  }, [on]);
}
