import { Task } from './types';
import { dateFromKey } from './utils';

const DAY = 86400000;

function startOfWeekSun(d: Date): number {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - x.getDay()); // back to Sunday
  return x.getTime();
}
const weekOfMonth = (d: Date) => Math.ceil(d.getDate() / 7);

// Does a task (single or repeating) occur on the given local day?
export function occursOn(task: Task, dateKey: string): boolean {
  const base = task.date;
  if (!base) return false; // to-do — no date
  if (dateKey < base) return false;
  if (task.repeat && task.repeat.endDate && dateKey > task.repeat.endDate) return false;
  if (!task.repeat) return dateKey === base;

  const r = task.repeat;
  const B = dateFromKey(base);
  const D = dateFromKey(dateKey);
  const interval = Math.max(1, r.interval);

  switch (r.freq) {
    case 'daily': {
      const days = Math.round((D.getTime() - B.getTime()) / DAY);
      return days >= 0 && days % interval === 0;
    }
    case 'weekly': {
      const weekdays = r.weekdays.length ? r.weekdays : [B.getDay()];
      if (!weekdays.includes(D.getDay())) return false;
      const weeks = Math.round((startOfWeekSun(D) - startOfWeekSun(B)) / (7 * DAY));
      return weeks >= 0 && weeks % interval === 0;
    }
    case 'monthly': {
      const months = (D.getFullYear() - B.getFullYear()) * 12 + (D.getMonth() - B.getMonth());
      if (months < 0 || months % interval !== 0) return false;
      if (r.monthlyMode === 'weekday') return D.getDay() === B.getDay() && weekOfMonth(D) === weekOfMonth(B);
      return D.getDate() === B.getDate();
    }
    case 'yearly': {
      const years = D.getFullYear() - B.getFullYear();
      if (years < 0 || years % interval !== 0) return false;
      return D.getMonth() === B.getMonth() && D.getDate() === B.getDate();
    }
  }
}

// Virtual instance ids for repeating occurrences: "<baseId>@<dateKey>".
export function instanceId(baseId: string, dateKey: string): string {
  return `${baseId}@${dateKey}`;
}
export function parseId(id: string): { baseId: string; date: string | null } {
  const i = id.indexOf('@');
  return i < 0 ? { baseId: id, date: null } : { baseId: id.slice(0, i), date: id.slice(i + 1) };
}

// One occurrence of a repeating task as a task of its own: its day, its done
// state, and its subtasks ticked off for that day only.
export function occurrence(t: Task, dateKey: string): Task {
  const ticked = t.subDone?.[dateKey];
  return {
    ...t,
    id: instanceId(t.id, dateKey),
    date: dateKey,
    done: t.doneDates.includes(dateKey),
    subtasks: t.subtasks.map((s) => ({ ...s, done: !!ticked?.includes(s.id) })),
  };
}

// All task instances occurring on a given day (single tasks and expanded repeats).
export function expandForDay(tasks: Task[], dateKey: string): Task[] {
  const out: Task[] = [];
  for (const t of tasks) {
    if (t.type === 'todo') continue;
    if (!occursOn(t, dateKey)) continue;
    out.push(t.repeat ? occurrence(t, dateKey) : t);
  }
  return out;
}

/** Subtasks still open — a task can't be completed while any are. */
export const openSubtasks = (t: Pick<Task, 'subtasks'>) => t.subtasks.filter((s) => !s.done).length;
