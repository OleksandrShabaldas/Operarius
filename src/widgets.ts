import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as W from '../modules/widgets';
import { occurrence, occursOn } from './recurrence';
import { Settings, Task } from './types';
import { addDays, dateFromKey, dateKey, findTag, fmtDur, tagLabel } from './utils';

// ---------------------------------------------------------------------------
// Home-screen widgets — what they draw: the days around today in full (so the
// timeline rolls over at midnight on its own), and for the months around this
// one each day's first three tasks — starred first, then all-day (no set
// time), then by time.
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

function subLine(t: Task, s: Settings): string {
  const bits: string[] = [];
  if (t.type === 'planned') bits.push(fmtDur(t.dur));
  else bits.push('All day');
  const tag = findTag(s.tags, t.tagId);
  if (tag) bits.push(tagLabel(tag));
  const place = t.placeId ? s.places.find((p) => p.id === t.placeId) : null;
  if (place) bits.push(place.name);
  if (t.subtasks.length) bits.push(`${t.subtasks.filter((x) => x.done).length}/${t.subtasks.length} subtasks`);
  return bits.join(' · ');
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
    days[d] = (byDay.get(d) ?? []).map((t) => ({
      k: t.id,
      t: t.title,
      e: t.emoji,
      c: t.color,
      a: t.type === 'allday' ? 1 : 0,
      s: t.start,
      d: t.dur,
      x: t.done ? 1 : 0,
      st: t.starred ? 1 : 0,
      sub: subLine(t, s),
    }));
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
  return JSON.stringify({ v: 1, clock24: s.clock === '24h', weekStart: s.weekStart, days, month });
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
  }, [loaded, tasks, settings.clock, settings.weekStart, settings.tags, settings.places]);

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
