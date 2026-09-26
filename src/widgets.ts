import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as W from '../modules/widgets';
import { occurrence, occursOn } from './recurrence';
import { Settings, Task } from './types';
import { addDays, dateFromKey, dateKey, findTag, placeLabel, tagLabel } from './utils';

// ---------------------------------------------------------------------------
// Home-screen widgets — what they draw: the days around today in full (so the
// timeline rolls over at midnight on its own), and for the months around this
// one each day's first three tasks — starred first, then all-day (no set
// time), then by time. Plus the day's window and gap length, so the timeline
// marks the day's start and end and free time the way the app does.
// ---------------------------------------------------------------------------

const DAYS_BACK = 1;
const DAYS_AHEAD = 7;
const MONTHS_BACK = 1;
const MONTHS_AHEAD = 6;

/** The month widget's order for a day's tasks. */
export function widgetOrder(a: Task, b: Task): number {
  return Number(!!b.starred) - Number(!!a.starred) || Number(a.type !== 'allday') - Number(b.type !== 'allday') || (a.type === 'allday' ? 0 : a.start - b.start) || a.title.localeCompare(b.title);
}

// Every task occurrence per day in [from, to] — single tasks bucketed once,
// only repeating ones checked day by day.
export function expandRange(tasks: Task[], from: string, to: string): Map<string, Task[]> {
  const out = new Map<string, Task[]>();
  const push = (d: string, t: Task) => {
    const l = out.get(d);
    if (l) l.push(t);
    else out.set(d, [t]);
  };
  const reps: Task[] = [];
  for (const t of tasks) {
    if (t.type === 'todo' || !t.date) continue;
    if (!t.repeat) {
      if (t.date >= from && t.date <= to) push(t.date, t);
    } else if (t.date <= to && (!t.repeat.endDate || t.repeat.endDate >= from)) reps.push(t);
  }
  if (reps.length) for (let d = from; d <= to; d = addDays(d, 1)) for (const r of reps) if (occursOn(r, d)) push(d, occurrence(r, d));
  return out;
}

// ---- Today's timeline, the widget's way ---------------------------------------

export type WRow =
  | { kind: 'now' }
  | { kind: 'card'; t: Task; line: number | null; running: boolean }
  | { kind: 'gap'; from: number; to: number; type: 'rail' | 'chip' | 'free'; live: boolean; inside: boolean; bounded: boolean; above: string | null; below: string | null }
  | { kind: 'overlap'; min: number; full: boolean }
  | { kind: 'edge'; end: boolean; min: number }
  | { kind: 'note'; title: string; sub: string; allDone: boolean }
  | { kind: 'next'; t: Task; more: number };

export const railColor = (t: Task) => (t.done ? '#4A4A52' : t.color);

/**
 * What's left of a day from the now line on, as the Today widget lists it (the
 * same rows as Timeline.kt's `Timeline.rows` — keep the two in step): tasks that
 * are over are left out; free time, short gaps, overlaps and the day's start and
 * end sit between the rest; tomorrow's first task comes last. `lineInCards`: the
 * task on now draws the now line across itself (Android 12+) instead of a line
 * above it.
 */
export function widgetTimeline(day: Task[], tomorrow: Task[], now: number, s: Pick<Settings, 'dayStart' | 'dayEnd' | 'gapThreshold'>, lineInCards = true): WRow[] {
  const out: WRow[] = [];
  const ahead = day.filter((t) => t.type === 'planned' && t.start + t.dur > now).sort((a, b) => a.start - b.start || b.dur - a.dur || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const ds = s.dayStart;
  const de = s.dayEnd;
  const window = ds < de;
  const edges: { end: boolean; min: number }[] = [];
  if (window && ds > now) edges.push({ end: false, min: ds });
  if (window && de > now) edges.push({ end: true, min: de });

  const first = ahead[0];
  if (!(lineInCards && first && first.start <= now)) out.push({ kind: 'now' });
  let cursor = now;
  let above: string | null = null;
  let fresh = true;
  let prev: Task | null = null;

  const gap = (to: number, below: string | null, bounded: boolean) => {
    const len = to - cursor;
    if (len < 0) return;
    if (len === 0) {
      if (above && below) out.push({ kind: 'gap', from: cursor, to, type: 'rail', live: false, inside: true, bounded, above, below });
      return;
    }
    const inside = !window || (cursor >= ds && to <= de);
    out.push({ kind: 'gap', from: cursor, to, type: inside && len > s.gapThreshold ? 'free' : 'chip', live: fresh, inside, bounded, above, below });
  };
  const edgesUpTo = (t: number) => {
    while (edges.length && edges[0].min <= t) {
      const e = edges.shift()!;
      gap(e.min, null, false);
      out.push({ kind: 'edge', ...e });
      cursor = Math.max(cursor, e.min);
      above = null;
      fresh = false;
    }
  };

  for (const t of ahead) {
    const st = t.start;
    const e = st + t.dur;
    if (prev && st < cursor) out.push({ kind: 'overlap', min: Math.min(cursor, e) - st, full: e <= cursor });
    else {
      edgesUpTo(st);
      gap(st, railColor(t), true);
    }
    const running = st <= now;
    out.push({ kind: 'card', t, line: lineInCards && !prev && running ? (now - st) / Math.max(1, t.dur) : null, running });
    cursor = Math.max(cursor, e);
    above = railColor(t);
    fresh = false;
    prev = t;
  }
  edgesUpTo(Infinity);

  if (!ahead.length && !(window && de > now)) {
    const open = day.filter((t) => !t.done).length;
    if (!day.length) out.push({ kind: 'note', title: 'Nothing planned today', sub: 'Tap + to add a task', allDone: false });
    else if (!open) out.push({ kind: 'note', title: 'All done for today', sub: day.length === 1 ? 'Your task is checked off' : `All ${day.length} tasks checked off`, allDone: true });
    else out.push({ kind: 'note', title: "That's all for today", sub: open === 1 ? '1 task still unchecked' : `${open} tasks still unchecked`, allDone: false });
  }

  const timed = tomorrow.filter((t) => t.type === 'planned');
  const lead = timed.length ? timed.reduce((a, b) => (b.start < a.start || (b.start === a.start && b.dur > a.dur) ? b : a)) : [...tomorrow].sort((a, b) => Number(!!b.starred) - Number(!!a.starred))[0];
  if (lead) out.push({ kind: 'next', t: lead, more: tomorrow.length - 1 });
  return out;
}

function monthStart(key: string, add: number): string {
  const d = dateFromKey(key);
  return dateKey(new Date(d.getFullYear(), d.getMonth() + add, 1));
}

/** The widgets' data, as JSON (see modules/widgets/android/.../Snapshot.kt). */
export function buildWidgetSnapshot(tasks: Task[], s: Settings, now = new Date()): string {
  const today = dateKey(now);
  const mFrom = monthStart(today, -MONTHS_BACK);
  const mTo = addDays(monthStart(today, MONTHS_AHEAD + 1), -1);
  const dFrom = addDays(today, -DAYS_BACK);
  const dTo = addDays(today, DAYS_AHEAD);
  const byDay = expandRange(tasks, dFrom < mFrom ? dFrom : mFrom, dTo > mTo ? dTo : mTo);

  const days: Record<string, unknown[]> = {};
  for (let d = dFrom; d <= dTo; d = addDays(d, 1)) {
    days[d] = (byDay.get(d) ?? []).map((t) => {
      const tag = findTag(s.tags, t.tagId);
      return {
        k: t.id,
        t: t.title,
        e: t.emoji,
        c: t.color,
        a: t.type === 'allday' ? 1 : 0,
        s: t.start,
        d: t.dur,
        x: t.done ? 1 : 0,
        st: t.starred ? 1 : 0,
        tg: tag ? tagLabel(tag) : '',
        tc: tag ? tag.color : '',
        pl: placeLabel(s.places, t.placeId),
        sb: t.subtasks.length ? `${t.subtasks.filter((x) => x.done).length}/${t.subtasks.length}` : '',
      };
    });
  }
  const month: Record<string, { n: number; i: { t: string; c: string; x: number }[] }> = {};
  for (let d = mFrom; d <= mTo; d = addDays(d, 1)) {
    const list = byDay.get(d);
    if (!list?.length) continue;
    month[d] = {
      n: list.length,
      i: [...list]
        .sort(widgetOrder)
        .slice(0, 3)
        .map((t) => ({ t: t.title, c: t.color, x: t.done ? 1 : 0 })),
    };
  }
  return JSON.stringify({ v: 2, clock24: s.clock === '24h', weekStart: s.weekStart, dayStart: s.dayStart, dayEnd: s.dayEnd, gap: s.gapThreshold, days, month });
}

/**
 * Keeps the widgets current: shortly after any change, right away when the
 * app goes to the background (you're about to see the home screen), and at
 * midnight while the app is open.
 */
export function useWidgetSync(opts: { loaded: boolean; tasks: Task[]; settings: Settings }) {
  const { loaded, tasks, settings } = opts;
  const latest = useRef({ tasks, settings });
  latest.current = { tasks, settings };
  const last = useRef('');
  const push = () => {
    const json = buildWidgetSnapshot(latest.current.tasks, latest.current.settings);
    if (json === last.current) return;
    last.current = json;
    W.update(json);
  };

  useEffect(() => {
    if (!loaded || !W.available) return;
    const t = setTimeout(push, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, tasks, settings.clock, settings.weekStart, settings.dayStart, settings.dayEnd, settings.gapThreshold, settings.tags, settings.places]);

  useEffect(() => {
    if (!loaded || !W.available) return;
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'background') push();
    });
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      const n = new Date();
      const next = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 5).getTime();
      timer = setTimeout(() => {
        push();
        arm();
      }, next - n.getTime());
    };
    arm();
    return () => {
      sub.remove();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);
}
