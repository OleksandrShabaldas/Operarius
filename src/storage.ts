import AsyncStorage from '@react-native-async-storage/async-storage';
import { Settings, Task } from './types';
import { DEFAULT_DAY_START, DEFAULT_DAY_END } from './theme';

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

export const DEFAULT_SETTINGS: Settings = {
  dayStart: DEFAULT_DAY_START,
  dayEnd: DEFAULT_DAY_END,
  weekStart: 'mon',
};

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
      return Array.isArray(parsed) ? (parsed as Task[]) : [];
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
      return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
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
  const base: Omit<Task, 'id' | 'date'>[] = [
    { title: 'Morning run', emoji: '🏃', color: '#5FD08A', start: 7 * 60, dur: 30, done: true, tag: 'Health' },
    { title: 'Shower', emoji: '🚿', color: '#5B9DF9', start: 8 * 60, dur: 15, done: false, tag: '' },
    { title: 'Breakfast', emoji: '🍳', color: '#F2C14E', start: 8 * 60 + 15, dur: 30, done: false, tag: '' },
    { title: 'Deep work — draft proposal', emoji: '💻', color: '#7C7CF0', start: 9 * 60 + 30, dur: 90, done: false, tag: 'Focus' },
    { title: 'Team standup', emoji: '👥', color: '#B57CF0', start: 11 * 60 + 30, dur: 30, done: false, tag: 'Work' },
    { title: 'Lunch', emoji: '🥗', color: '#4FD1C5', start: 13 * 60, dur: 45, done: false, tag: 'Personal' },
    { title: 'Design review', emoji: '🎨', color: '#F8677A', start: 15 * 60, dur: 60, done: false, tag: 'Work' },
    { title: 'Gym', emoji: '🏋️', color: '#F5A15C', start: 17 * 60 + 30, dur: 60, done: false, tag: 'Health' },
    { title: 'Read', emoji: '📖', color: '#F072B6', start: 21 * 60, dur: 30, done: false, tag: '' },
  ];
  return base.map((t, i) => ({ ...t, id: `seed-${i + 1}`, date: todayKey }));
}
