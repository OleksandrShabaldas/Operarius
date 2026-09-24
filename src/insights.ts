import { Tag, Task, WeekStart } from './types';
import { expandForDay, occursOn } from './recurrence';
import { addDays, dateFromKey, dateKey, fmtDur, weekOf } from './utils';
import { MONTHS, WEEKDAYS_FULL } from './theme';

// ---------------------------------------------------------------------------
// Everything behind the Insights screen. Days are judged on their dated tasks
// (planned + all-day, repeating occurrences included); time is planned time.
// ---------------------------------------------------------------------------

export type Period = 'day' | 'week' | 'month';

// empty    nothing planned
// perfect  everything done
// open     today, not everything done yet (still in play)
// partial  a past day with some done
// missed   a past day with nothing done
// future   after today
export type DayState = 'empty' | 'perfect' | 'open' | 'partial' | 'missed' | 'future';
export type DayStat = { key: string; total: number; done: number; sched: number; doneMin: number; state: DayState };

/** A memoised per-day summary. */
export function dayStats(tasks: Task[], today: string): (key: string) => DayStat {
  const cache = new Map<string, DayStat>();
  return (key) => {
    const hit = cache.get(key);
    if (hit) return hit;
    let total = 0;
    let done = 0;
    let sched = 0;
    let doneMin = 0;
    for (const t of expandForDay(tasks, key)) {
      total++;
      if (t.done) done++;
      if (t.type === 'planned') {
        sched += t.dur;
        if (t.done) doneMin += t.dur;
      }
    }
    const state: DayState =
      key > today ? 'future' : total === 0 ? 'empty' : done === total ? 'perfect' : key === today ? 'open' : done === 0 ? 'missed' : 'partial';
    const s = { key, total, done, sched, doneMin, state };
    cache.set(key, s);
    return s;
  };
}

/** The first day anything was planned (to-dos have no day). */
export function firstDay(tasks: Task[]): string | null {
  let min: string | null = null;
  for (const t of tasks) if (t.type !== 'todo' && t.date && (!min || t.date < min)) min = t.date;
  return min;
}

// ---- Periods -----------------------------------------------------------------

export function periodKeys(period: Period, anchor: string, weekStart: WeekStart): string[] {
  if (period === 'day') return [anchor];
  if (period === 'week') return weekOf(anchor, weekStart);
  const d = dateFromKey(anchor);
  const n = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return Array.from({ length: n }, (_, i) => dateKey(new Date(d.getFullYear(), d.getMonth(), i + 1)));
}

export function shiftPeriod(period: Period, anchor: string, dir: number): string {
  if (period === 'day') return addDays(anchor, dir);
  if (period === 'week') return addDays(anchor, 7 * dir);
  const d = dateFromKey(anchor);
  return dateKey(new Date(d.getFullYear(), d.getMonth() + dir, 1));
}

const mon3 = (d: Date) => MONTHS[d.getMonth()].slice(0, 3);

/** "Today" / "This week" / "August" … and the dates it spans. */
export function periodTitle(period: Period, anchor: string, weekStart: WeekStart, today: string): { title: string; range: string } {
  const a = dateFromKey(anchor);
  if (period === 'day') {
    const range = `${WEEKDAYS_FULL[a.getDay()]}, ${mon3(a)} ${a.getDate()}`;
    if (anchor === today) return { title: 'Today', range };
    if (anchor === addDays(today, -1)) return { title: 'Yesterday', range };
    return { title: `${mon3(a)} ${a.getDate()}`, range };
  }
  if (period === 'week') {
    const keys = weekOf(anchor, weekStart);
    const s = dateFromKey(keys[0]);
    const e = dateFromKey(keys[6]);
    const range = s.getMonth() === e.getMonth() ? `${mon3(s)} ${s.getDate()} – ${e.getDate()}` : `${mon3(s)} ${s.getDate()} – ${mon3(e)} ${e.getDate()}`;
    const cur = weekOf(today, weekStart)[0];
    if (keys[0] === cur) return { title: 'This week', range };
    if (keys[0] === addDays(cur, -7)) return { title: 'Last week', range };
    return { title: range, range: `${s.getFullYear()}` };
  }
  const t = dateFromKey(today);
  const range = `${MONTHS[a.getMonth()]} ${a.getFullYear()}`;
  if (a.getFullYear() === t.getFullYear() && a.getMonth() === t.getMonth()) return { title: 'This month', range };
  const prev = new Date(t.getFullYear(), t.getMonth() - 1, 1);
  if (a.getFullYear() === prev.getFullYear() && a.getMonth() === prev.getMonth()) return { title: 'Last month', range };
  return { title: MONTHS[a.getMonth()], range: `${a.getFullYear()}` };
}

/** How the previous period is referred to. */
export function prevName(period: Period): string {
  return period === 'day' ? 'the day before' : period === 'week' ? 'the week before' : 'the month before';
}

/** The same point of the previous period, for a period still running. */
export function prevPoint(period: Period): string {
  return period === 'week' ? 'this point last week' : 'this point last month';
}

export type Totals = { total: number; done: number; sched: number; doneMin: number; slipped: number; days: DayStat[] };

/** Sums over a period. `slippedToday`: today's tasks already over and not done. */
export function totals(keys: string[], stat: (k: string) => DayStat, today: string, slippedToday = 0): Totals {
  const days = keys.map(stat);
  const r: Totals = { total: 0, done: 0, sched: 0, doneMin: 0, slipped: 0, days };
  for (const d of days) {
    r.total += d.total;
    r.done += d.done;
    r.sched += d.sched;
    r.doneMin += d.doneMin;
    if (d.key < today) r.slipped += d.total - d.done;
    else if (d.key === today) r.slipped += slippedToday;
  }
  return r;
}

/** Today's planned tasks whose time is over but that aren't done ("Missed" on the timeline). */
export function overToday(tasks: Task[], today: string, nowMin: number): number {
  return expandForDay(tasks, today).filter((t) => t.type === 'planned' && !t.done && t.start + t.dur <= nowMin).length;
}

// ---- Streaks -------------------------------------------------------------------
// A streak counts days in a row on which everything planned got done. Days with
// nothing planned don't break it, and today only counts once it's complete (it
// can't break the streak while it's still going).

export type Streak = { current: number; best: number };

export function perfectStreak(stat: (k: string) => DayStat, first: string | null, today: string): Streak {
  if (!first || first > today) return { current: 0, best: 0 };
  let run = 0;
  let best = 0;
  for (let k = first; k <= today; k = addDays(k, 1)) {
    const s = stat(k).state;
    if (s === 'perfect') best = Math.max(best, ++run);
    else if (s === 'partial' || s === 'missed') run = 0;
  }
  return { current: run, best };
}

// ---- Routines (repeating tasks) ---------------------------------------------------

export type Mark = 'done' | 'missed' | 'pending';
export type Routine = { id: string; title: string; emoji: string; color: string; current: number; best: number; rate: number; recent: Mark[] };

/** Each repeating task's run of kept occurrences (today's, if still open, doesn't break it). */
export function routines(tasks: Task[], today: string): Routine[] {
  const out: Routine[] = [];
  for (const t of tasks) {
    if (!t.repeat || t.type === 'todo' || !t.date || t.date > today) continue;
    const end = t.repeat.endDate && t.repeat.endDate < today ? t.repeat.endDate : today;
    const occ: string[] = [];
    for (let k = t.date; k <= end; k = addDays(k, 1)) if (occursOn(t, k)) occ.push(k);
    if (occ.length < 2) continue;
    const kept = new Set(t.doneDates);
    let run = 0;
    let best = 0;
    let hits = 0;
    let judged = 0;
    for (const k of occ) {
      if (kept.has(k)) {
        best = Math.max(best, ++run);
        hits++;
        judged++;
      } else if (k !== today) {
        run = 0;
        judged++;
      }
    }
    const recent: Mark[] = occ.slice(-7).map((k) => (kept.has(k) ? 'done' : k === today ? 'pending' : 'missed'));
    out.push({ id: t.id, title: t.title, emoji: t.emoji, color: t.color, current: run, best, rate: judged ? hits / judged : 0, recent });
  }
  return out.sort((a, b) => b.current - a.current || b.rate - a.rate || a.title.localeCompare(b.title));
}

// ---- Consistency grid -----------------------------------------------------------------

export type HeatCell = { key: string; state: DayState; ratio: number };

/** `weeks` columns of 7 days, the last one being this week. */
export function heatmap(stat: (k: string) => DayStat, today: string, weekStart: WeekStart, weeks: number): HeatCell[][] {
  const last = weekOf(today, weekStart)[0];
  const cols: HeatCell[][] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const start = addDays(last, -7 * w);
    cols.push(
      Array.from({ length: 7 }, (_, i) => {
        const s = stat(addDays(start, i));
        return { key: s.key, state: s.state, ratio: s.total ? s.done / s.total : 0 };
      })
    );
  }
  return cols;
}

// ---- Time by tag -----------------------------------------------------------------------

export type TagSlice = { id: string; name: string; color: string; mins: number; share: number; total: number; done: number };

/** Planned time per top-level tag (sub-tags roll up), biggest first. */
export function tagSlices(tasks: Task[], keys: string[], tags: Tag[], untaggedColor: string): TagSlice[] {
  const byId = new Map(tags.map((t) => [t.id, t]));
  const top = (id: string | null) => {
    const t = id ? byId.get(id) : undefined;
    if (!t) return null;
    return t.parentId ? byId.get(t.parentId) ?? t : t;
  };
  const acc = new Map<string, TagSlice>();
  let all = 0;
  for (const k of keys) {
    for (const t of expandForDay(tasks, k)) {
      if (t.type !== 'planned') continue;
      const tg = top(t.tagId);
      const id = tg?.id ?? '__none';
      let s = acc.get(id);
      if (!s) {
        s = { id, name: tg?.name ?? 'Untagged', color: tg?.color ?? untaggedColor, mins: 0, share: 0, total: 0, done: 0 };
        acc.set(id, s);
      }
      s.mins += t.dur;
      s.total++;
      if (t.done) s.done++;
      all += t.dur;
    }
  }
  const list = [...acc.values()].filter((s) => s.mins > 0);
  list.forEach((s) => (s.share = all ? s.mins / all : 0));
  return list.sort((a, b) => b.mins - a.mins);
}

// ---- Rhythm ------------------------------------------------------------------------------

export type Rhythm = {
  hours: number[]; // completed minutes per clock hour (0–23)
  peak: number | null; // busiest hour
  weekdays: { total: number; done: number }[]; // Sun..Sat
  best: number | null; // weekday with the best completion rate (enough data)
  completed: number; // tasks completed in the window
};

/** When things get done, over the last `days` days. */
export function rhythm(tasks: Task[], stat: (k: string) => DayStat, today: string, days: number): Rhythm {
  const hours = Array(24).fill(0);
  const weekdays = Array.from({ length: 7 }, () => ({ total: 0, done: 0 }));
  let completed = 0;
  for (let i = 0; i < days; i++) {
    const k = addDays(today, -i);
    const s = stat(k);
    if (!s.total) continue;
    const dow = dateFromKey(k).getDay();
    weekdays[dow].total += s.total;
    weekdays[dow].done += s.done;
    completed += s.done;
    for (const t of expandForDay(tasks, k)) {
      if (t.type !== 'planned' || !t.done) continue;
      // Spread the task over the hours it spans.
      let m = t.start;
      const end = Math.min(24 * 60, t.start + t.dur);
      while (m < end) {
        const h = Math.floor(m / 60);
        const next = Math.min(end, (h + 1) * 60);
        hours[h] += next - m;
        m = next;
      }
    }
  }
  let peak: number | null = null;
  hours.forEach((v, h) => {
    if (v > 0 && (peak == null || v > hours[peak])) peak = h;
  });
  let best: number | null = null;
  weekdays.forEach((w, d) => {
    if (w.total < 3) return;
    if (best == null || w.done / w.total > weekdays[best].done / weekdays[best].total) best = d;
  });
  return { hours, peak, weekdays, best, completed };
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const pctOf = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
export const hoursLabel = (mins: number) => (mins < 60 ? `${mins}m` : fmtDur(mins).replace(' hr', 'h').replace(' min', 'm'));
