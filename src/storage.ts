import AsyncStorage from '@react-native-async-storage/async-storage';
import { Place, Repeat, RepeatFreq, Settings, Tag, Task } from './types';
import {
  DEFAULT_DAY_START,
  DEFAULT_DAY_END,
  DEFAULT_GAP_THRESHOLD,
  DEFAULT_TIME_PRESETS,
  DEFAULT_DURATION_PRESETS,
  COLORS,
  EMOJIS,
  ICON_SLOTS,
  LEGACY_COLORS,
  PALETTE_SLOTS,
} from './theme';

// ---------------------------------------------------------------------------
// Persistence layer.
//
// Everything the app reads/writes goes through the `Repository` interface. The
// app currently uses a local AsyncStorage-backed implementation, but the shape
// is intentionally async and self-contained so that a future cloud backend
// (shared with a desktop client) can implement the same interface and be
// swapped in without touching the UI layer.
// ---------------------------------------------------------------------------

const K_TASKS = 'operarius.tasks.v1';
const K_SETTINGS = 'operarius.settings.v1';
const K_SEEDED = 'operarius.seeded.v1';

export const DEFAULT_TAGS: Tag[] = [
  { id: 'work', name: 'Work', parentId: null, color: '#7C7CF0' },
  { id: 'focus', name: 'Focus', parentId: null, color: '#5B9DF9' },
  { id: 'health', name: 'Health', parentId: null, color: '#5FD08A' },
  { id: 'personal', name: 'Personal', parentId: null, color: '#4FD1C5' },
  { id: 'errand', name: 'Errand', parentId: null, color: '#F5A15C' },
];

export const DEFAULT_PLACES: Place[] = [
  { id: 'home', name: 'Home', tagId: null, link: '', photoUri: null },
  { id: 'office', name: 'Office', tagId: 'work', link: '', photoUri: null },
];

const toPresets = (vals: number[]): { value: number; tagId: string | null }[] =>
  vals.map((v) => ({ value: v, tagId: null }));

export const DEFAULT_SETTINGS: Settings = {
  dayStart: DEFAULT_DAY_START,
  dayEnd: DEFAULT_DAY_END,
  weekStart: 'mon',
  clock: '24h',
  gapThreshold: DEFAULT_GAP_THRESHOLD,
  tags: DEFAULT_TAGS,
  places: DEFAULT_PLACES,
  timePresets: toPresets(DEFAULT_TIME_PRESETS),
  durationPresets: toPresets(DEFAULT_DURATION_PRESETS),
  colors: [...COLORS],
  emojis: [...EMOJIS],
  swapOnDrag: false,
};

// The palette / icon set always hold exactly `n` distinct entries (so pickers
// show full rows): extras are trimmed and gaps topped up with unused defaults.
export function fitSlots(raw: unknown, defaults: string[], n: number): string[] {
  const list = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string' && v.trim() !== '') : [];
  const out: string[] = [];
  const has = (v: string) => out.some((o) => o.toLowerCase() === v.toLowerCase());
  for (const v of list) if (!has(v)) out.push(v);
  for (const d of defaults) if (out.length < n && !has(d)) out.push(d);
  return out.slice(0, n);
}

const sameList = (a: unknown, b: string[]) =>
  Array.isArray(a) && a.length === b.length && a.every((v, i) => typeof v === 'string' && v.toLowerCase() === b[i].toLowerCase());

// Normalize a persisted preset list (older builds stored plain numbers).
function migratePresets(raw: any, fallback: { value: number; tagId: string | null }[]) {
  if (!Array.isArray(raw) || raw.length === 0) return fallback;
  return raw.map((p) => (typeof p === 'number' ? { value: p, tagId: null } : { value: p.value, tagId: p.tagId ?? null }));
}

function migratePlace(raw: any): Place {
  return {
    id: String(raw.id),
    name: raw.name ?? 'Place',
    tagId: typeof raw.tagId === 'string' ? raw.tagId : null,
    link: typeof raw.link === 'string' ? raw.link : '',
    photoUri: typeof raw.photoUri === 'string' ? raw.photoUri : null,
  };
}

// Migrate a persisted task from older shapes (e.g. `tag` string) to the current one.
function migrateTask(raw: any): Task {
  const tagId =
    typeof raw.tagId === 'string' || raw.tagId === null
      ? raw.tagId
      : typeof raw.tag === 'string' && raw.tag
        ? raw.tag.toLowerCase()
        : null;
  const type = raw.type === 'allday' || raw.type === 'todo' ? raw.type : 'planned';
  return {
    id: String(raw.id),
    title: raw.title ?? 'Untitled',
    emoji: raw.emoji ?? '📝',
    color: raw.color ?? '#5B9DF9',
    type,
    start: raw.start ?? 0,
    dur: raw.dur ?? 30,
    done: !!raw.done,
    tagId: tagId ?? null,
    placeId: typeof raw.placeId === 'string' ? raw.placeId : null,
    date: type === 'todo' ? null : (raw.date ?? null),
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    subtasks: Array.isArray(raw.subtasks) ? raw.subtasks : [],
    repeat: migrateRepeat(raw.repeat),
    doneDates: Array.isArray(raw.doneDates) ? raw.doneDates.filter((d: any) => typeof d === 'string') : [],
    expanded: !!raw.expanded,
  };
}

function migrateRepeat(raw: any): Repeat | null {
  if (!raw || typeof raw !== 'object') return null;
  const freqs: RepeatFreq[] = ['daily', 'weekly', 'monthly', 'yearly'];
  if (!freqs.includes(raw.freq)) return null;
  return {
    freq: raw.freq,
    interval: Math.max(1, Number(raw.interval) || 1),
    weekdays: Array.isArray(raw.weekdays) ? raw.weekdays.filter((n: any) => typeof n === 'number') : [],
    monthlyMode: raw.monthlyMode === 'weekday' ? 'weekday' : 'date',
    endDate: typeof raw.endDate === 'string' ? raw.endDate : null,
  };
}

export interface Repository {
  loadTasks(): Promise<Task[]>;
  saveTasks(tasks: Task[]): Promise<void>;
  loadSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;
  isSeeded(): Promise<boolean>;
  markSeeded(): Promise<void>;
}

export const localRepository: Repository = {
  async loadTasks() {
    try {
      const raw = await AsyncStorage.getItem(K_TASKS);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((t) => t && t.id).map(migrateTask) : [];
    } catch {
      return [];
    }
  },
  async saveTasks(tasks) {
    try {
      await AsyncStorage.setItem(K_TASKS, JSON.stringify(tasks));
    } catch {
      // Swallow write errors; state stays correct in-memory for this session.
    }
  },
  async loadSettings() {
    try {
      const raw = await AsyncStorage.getItem(K_SETTINGS);
      if (!raw) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(raw) as Partial<Settings>;
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        // Never let a stored blob leave these empty/broken.
        tags: (Array.isArray(parsed.tags) && parsed.tags.length ? parsed.tags : DEFAULT_TAGS).map((t: Tag) => ({
          ...t,
          color: t.color || DEFAULT_TAGS.find((d) => d.id === t.id)?.color || '#5B9DF9',
        })),
        places: Array.isArray(parsed.places) ? parsed.places.map(migratePlace) : DEFAULT_PLACES,
        timePresets: migratePresets(parsed.timePresets, toPresets(DEFAULT_TIME_PRESETS)),
        durationPresets: migratePresets(parsed.durationPresets, toPresets(DEFAULT_DURATION_PRESETS)),
        colors: sameList(parsed.colors, LEGACY_COLORS) ? [...COLORS] : fitSlots(parsed.colors, COLORS, PALETTE_SLOTS),
        emojis: fitSlots(parsed.emojis, EMOJIS, ICON_SLOTS),
        swapOnDrag: typeof parsed.swapOnDrag === 'boolean' ? parsed.swapOnDrag : false,
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  },
  async saveSettings(s) {
    try {
      await AsyncStorage.setItem(K_SETTINGS, JSON.stringify(s));
    } catch {
      /* ignore */
    }
  },
  async isSeeded() {
    try {
      return (await AsyncStorage.getItem(K_SEEDED)) === '1';
    } catch {
      return false;
    }
  },
  async markSeeded() {
    try {
      await AsyncStorage.setItem(K_SEEDED, '1');
    } catch {
      /* ignore */
    }
  },
};

// The sample day from the prototype, seeded onto the first launch so a new
// install opens looking exactly like the design.
export function seedTasks(todayKey: string): Task[] {
  const base: Omit<Task, 'id' | 'date' | 'type' | 'notes' | 'subtasks' | 'repeat' | 'doneDates' | 'expanded'>[] = [
    { title: 'Morning run', emoji: '🏃', color: '#5FD08A', start: 7 * 60, dur: 30, done: true, tagId: 'health', placeId: null },
    { title: 'Shower', emoji: '🚿', color: '#5B9DF9', start: 8 * 60, dur: 15, done: false, tagId: null, placeId: null },
    { title: 'Breakfast', emoji: '🍳', color: '#F2C14E', start: 8 * 60 + 15, dur: 30, done: false, tagId: null, placeId: null },
    { title: 'Deep work — draft proposal', emoji: '💻', color: '#7C7CF0', start: 9 * 60 + 30, dur: 90, done: false, tagId: 'focus', placeId: null },
    { title: 'Team standup', emoji: '👥', color: '#B57CF0', start: 11 * 60 + 30, dur: 30, done: false, tagId: 'work', placeId: null },
    { title: 'Lunch', emoji: '🥗', color: '#4FD1C5', start: 13 * 60, dur: 45, done: false, tagId: 'personal', placeId: null },
    { title: 'Design review', emoji: '🎨', color: '#F8677A', start: 15 * 60, dur: 60, done: false, tagId: 'work', placeId: null },
    { title: 'Gym', emoji: '🏋️', color: '#F5A15C', start: 17 * 60 + 30, dur: 60, done: false, tagId: 'health', placeId: null },
    { title: 'Read', emoji: '📖', color: '#F072B6', start: 21 * 60, dur: 30, done: false, tagId: null, placeId: null },
  ];
  return base.map((t, i) => ({
    ...t,
    id: `seed-${i + 1}`,
    type: 'planned',
    date: todayKey,
    notes: '',
    subtasks: [],
    repeat: null,
    doneDates: [],
    expanded: false,
  }));
}
