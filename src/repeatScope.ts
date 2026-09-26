import { firstOccurrence } from './calendarSync';
import { occurrence } from './recurrence';
import { Draft, Task } from './types';
import { addDays } from './utils';

// ---------------------------------------------------------------------------
// Changing part of a repeating series:
//  • one day — it becomes a task of its own and is taken out of the series;
//  • a day and the ones after it — the series ends the day before and a new
//    one starts that day;
//  • all of it — the series itself (nothing to work out here).
// Each day's own state (done, subtasks ticked, days taken out, custom
// reminders) goes with the part it belongs to.
// ---------------------------------------------------------------------------

/** A task whose days can be changed one by one (not a multi-day event brought in from the calendar). */
export const isSeries = (t: Pick<Task, 'repeat' | 'cal'>) => !!t.repeat && !t.cal?.span;

/** Is `date` the series' first day (so "this and following" is all of it)? */
export const isFirstDay = (t: Task, date: string) => date <= firstOccurrence(t);

const pick = (m: Record<string, string[]> | undefined, keep: (d: string) => boolean) => {
  if (!m) return undefined;
  const out: Record<string, string[]> = {};
  for (const [d, ids] of Object.entries(m)) if (keep(d)) out[d] = ids;
  return Object.keys(out).length ? out : undefined;
};

// The per-day state of the days `keep` accepts.
function days(t: Task, keep: (d: string) => boolean): Pick<Task, 'doneDates' | 'subDone' | 'skip' | 'reminders'> {
  const skip = t.skip?.filter(keep);
  return {
    doneDates: t.doneDates.filter(keep),
    subDone: pick(t.subDone, keep),
    skip: skip?.length ? skip : undefined,
    reminders: t.reminders ? { ...t.reminders, custom: t.reminders.custom.filter((c) => keep(c.date)) } : null,
  };
}

/** The series without `date` (it's deleted, or became a task of its own). */
export function withoutDay(base: Task, date: string): Task {
  return { ...base, ...days(base, (d) => d !== date), reminders: base.reminders, skip: [...(base.skip ?? []).filter((d) => d !== date), date] };
}

/** The series ending the day before `date`; null when that's all of it. */
export function endBefore(base: Task, date: string): Task | null {
  if (isFirstDay(base, date)) return null;
  return { ...base, ...days(base, (d) => d < date), repeat: { ...base.repeat!, endDate: addDays(date, -1) } };
}

/** The editor's draft for one day of a series (saved as a task of its own). */
export function dayDraft(base: Task, date: string): Draft {
  const { id: _id, cal: _cal, subDone: _sd, skip: _sk, ...occ } = occurrence(base, date);
  return {
    ...occ,
    repeat: null,
    doneDates: [],
    reminders: base.reminders ? { ...base.reminders, custom: [] } : null,
    scope: { kind: 'one', baseId: base.id, date },
  };
}

/** The editor's draft for a day of a series and the ones after it (saved as a new series). */
export function restDraft(base: Task, date: string): Draft {
  const { id: _id, cal: _cal, ...rest } = base;
  return { ...rest, ...days(base, (d) => d >= date), date, scope: { kind: 'following', baseId: base.id, date } };
}

/** Moving one day, or it and the ones after it, to another time: the tasks to put in place of the series. */
export function moveDays(base: Task, date: string, scope: 'one' | 'following', start: number, newId: () => string): Task[] {
  if (scope === 'one') {
    const { scope: _s, ...d } = dayDraft(base, date);
    return [withoutDay(base, date), { ...d, id: newId(), start }];
  }
  const head = endBefore(base, date);
  if (!head) return [{ ...base, start }];
  const { scope: _s, ...d } = restDraft(base, date);
  return [head, { ...d, id: newId(), start }];
}
