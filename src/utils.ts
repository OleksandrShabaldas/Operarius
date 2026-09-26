import { DOW, MONTHS, WEEKDAYS_FULL } from './theme';
import { Clock, Place, Repeat, Tag, WeekStart } from './types';

// hex -> rgba string with alpha
export function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// The colour mixed toward the app background by `k` (0 = itself, 1 = background):
// the look of `hexA(hex, 1 - k)` over the background, but opaque.
export function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number, bg: number) => Math.round(c + (bg - c) * k);
  return `rgb(${mix((n >> 16) & 255, 11)},${mix((n >> 8) & 255, 11)},${mix(n & 255, 13)})`;
}

// minutes-of-day -> "7:00 AM" (12h) or "07:00" (24h)
export function fmt(min: number, clock: Clock = '12h'): string {
  min = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (clock === '24h') return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const ap = h < 12 ? 'AM' : 'PM';
  const hh = h % 12 || 12;
  return `${hh}:${String(m).padStart(2, '0')} ${ap}`;
}

// duration minutes -> "30 min" / "1h 30m" / "1 hr"
export function fmtDur(d: number): string {
  if (d < 60) return d + ' min';
  const h = Math.floor(d / 60);
  const m = d % 60;
  return m ? `${h}h ${m}m` : `${h} hr`;
}

// hours as short label, e.g. 1.5 -> "1.5h", 2 -> "2h"
export function fmtHours(mins: number): string {
  const h = mins / 60;
  if (h === 0) return '0h';
  const rounded = Math.round(h * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}h`;
}

// ---- Date helpers ---------------------------------------------------------

// Local YYYY-MM-DD key for a Date.
export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Parse a YYYY-MM-DD key into a local Date (midnight).
export function dateFromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayKey(): string {
  return dateKey(new Date());
}

// Add days to a key, returning a new key.
export function addDays(key: string, n: number): string {
  const d = dateFromKey(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

// Calendar days from the moment `at` to `now` — by date, not 24-hour spans:
// last night is 1 ("yesterday") even if it's only a few hours ago.
export function daysAgo(at: number, now = Date.now()): number {
  const day = (t: number) => {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  return Math.round((day(now) - day(at)) / 86400000); // (rounded: a DST day is 23 or 25 hours)
}

// Return the 7 date keys of the week containing `key`, honoring weekStart.
export function weekOf(key: string, weekStart: WeekStart): string[] {
  const d = dateFromKey(key);
  const dow = d.getDay(); // 0=Sun..6=Sat
  const offset = weekStart === 'mon' ? (dow + 6) % 7 : dow;
  const start = new Date(d);
  start.setDate(d.getDate() - offset);
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(start);
    x.setDate(start.getDate() + i);
    return dateKey(x);
  });
}

// Labels for the week strip header row (single letters), honoring weekStart.
export function weekdayLetters(weekStart: WeekStart): string[] {
  const base = ['S', 'M', 'T', 'W', 'T', 'F', 'S']; // Sun..Sat
  if (weekStart === 'mon') return [...base.slice(1), base[0]];
  return base;
}

export function headerParts(key: string): { dayNum: number; weekday: string; month: string } {
  const d = dateFromKey(key);
  return {
    dayNum: d.getDate(),
    weekday: WEEKDAYS_FULL[d.getDay()],
    month: MONTHS[d.getMonth()],
  };
}

export function genId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

// ---- Tag / place lookups --------------------------------------------------

export function findTag(tags: Tag[], id: string | null): Tag | null {
  return id ? tags.find((t) => t.id === id) || null : null;
}

// The name a task shows: its alternative one when that's picked (tap the name to switch).
export function shownTitle(t: { title: string; alt?: string; showAlt?: boolean }): string {
  return t.showAlt && t.alt?.trim() ? t.alt.trim() : t.title;
}

// A tag as shown on chips and in pickers: its icon before the name.
export function tagLabel(t: Tag): string {
  return t.icon ? `${t.icon} ${t.name}` : t.name;
}

export function placeLabel(places: Place[], id: string | null): string {
  const p = id ? places.find((x) => x.id === id) : null;
  return p ? p.name : '';
}

const DOW3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Human-readable recurrence rule, e.g. "Every 2 weeks · Mon, Wed" or "Every month".
export function repeatSummary(r: Repeat | null): string {
  if (!r) return 'Does not repeat';
  const n = r.interval;
  const unit = r.freq === 'daily' ? 'day' : r.freq === 'weekly' ? 'week' : r.freq === 'monthly' ? 'month' : 'year';
  const every = n > 1 ? `Every ${n} ${unit}s` : `Every ${unit}`;
  if (r.freq === 'weekly' && r.weekdays.length) {
    const days = [...r.weekdays].sort((a, b) => a - b).map((d) => DOW3[d]).join(', ');
    return `${every} · ${days}`;
  }
  return every;
}

// "Today" / "Tomorrow" / "Yesterday" / "Tue, Sep 15"
export function dateLabel(key: string | null): string {
  if (!key) return 'No date';
  const t = todayKey();
  if (key === t) return 'Today';
  if (key === addDays(t, 1)) return 'Tomorrow';
  if (key === addDays(t, -1)) return 'Yesterday';
  return shortDate(key);
}

// "Thu, Sep 24"
export function shortDate(key: string): string {
  const d = dateFromKey(key);
  return `${DOW[(d.getDay() + 6) % 7]}, ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
}

// The calendar date behind a relative label ("Today" → "Thu, Sep 24"), shown
// small next to it; null when the label already is the date.
export function dateHint(key: string | null): string | null {
  if (!key) return null;
  const t = todayKey();
  return key === t || key === addDays(t, 1) || key === addDays(t, -1) ? shortDate(key) : null;
}
