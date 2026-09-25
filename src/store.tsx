import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { CalendarSync, Draft, PlaceLocation, ReminderIntensity, Settings, Task } from './types';
import { DEFAULT_CALENDAR, DEFAULT_SETTINGS, localRepository, Repository, seedTasks } from './storage';
import { COLORS } from './theme';
import { expandForDay, parseId } from './recurrence';
import { genId, todayKey } from './utils';
import { applyOps, SyncOps } from './calendarSync';
import { Backup, restorePhotos } from './backup';

export type Snapshot = { tasks: Task[]; settings: Settings };
export type Deleted = { task: Task; index: number };
export type ImportResult = { tasks: number; tags: number; places: number };

type Ctx = {
  loaded: boolean;
  tasks: Task[];
  settings: Settings;
  tasksForDay: (dateKey: string) => Task[];
  saveDraft: (draft: Draft) => void; // add when no id, else update
  deleteTask: (id: string) => Deleted | null; // what was removed (to undo it)
  restoreTask: (d: Deleted) => void; // undo a delete
  toggleDone: (id: string) => void;
  setDone: (id: string, done: boolean) => void; // e.g. "Done" pressed on a reminder
  toggleSubtask: (taskId: string, subId: string) => void;
  toggleExpanded: (id: string) => void; // show/hide subtasks inline on the card
  toggleStar: (id: string) => void; // high priority on / off
  moveTask: (id: string, start: number) => void; // commit a drag
  updateSettings: (patch: Partial<Settings>) => void;
  updateCalendar: (patch: Partial<CalendarSync>) => void; // Settings → Google Calendar
  applyCalendarSync: (ops: SyncOps, patch: Partial<CalendarSync>) => void; // a sync's changes to the tasks + its state
  importBackup: (b: Backup, mode: 'replace' | 'merge') => ImportResult; // restore a backup (replace everything / add what's missing)
  restoreSnapshot: (s: Snapshot) => void; // undo a restore
  resetAll: () => Snapshot; // delete all data: back to a fresh install (returns what was there, to undo)
  clearCompleted: (dateKey?: string) => void; // all days if omitted
  clearDay: (dateKey: string) => void;
  clearAll: () => void;
  // Tags & places
  addTag: (name: string, parentId?: string | null) => void;
  renameTag: (id: string, name: string) => void;
  setTagColor: (id: string, color: string) => void;
  setTagHideDots: (id: string, hide: boolean) => void; // keep the tag's tasks out of the week-strip dots
  setTagIcon: (id: string, icon: string | null) => void; // sub-tag icon (null = none)
  setTagIntensity: (id: string, intensity: ReminderIntensity | null) => void; // how its tasks' reminders start (null = the default / its parent's)
  deleteTag: (id: string) => void;
  addPlace: (name: string, tagId?: string | null) => void;
  renamePlace: (id: string, name: string) => void;
  setPlaceTag: (id: string, tagId: string | null) => void;
  setPlaceLink: (id: string, link: string) => void;
  setPlacePhoto: (id: string, photoUri: string | null) => void;
  setPlaceLocation: (id: string, loc: PlaceLocation | null) => void; // picked on Google Maps (null = clear)
  deletePlace: (id: string) => void;
};

const AppCtx = createContext<Ctx | null>(null);

// Are all of a task's subtasks ticked off (for one occurrence of a repeating task)?
function allSubsDone(t: Task, date: string | null): boolean {
  if (!t.subtasks.length) return true;
  if (t.repeat && date) {
    const ticked = t.subDone?.[date] ?? [];
    return t.subtasks.every((x) => ticked.includes(x.id));
  }
  return t.subtasks.every((x) => x.done);
}

export function AppProvider({
  children,
  repo = localRepository,
}: {
  children: React.ReactNode;
  repo?: Repository;
}) {
  const [loaded, setLoaded] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const didLoad = useRef(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  // Initial load (+ first-run seed).
  useEffect(() => {
    let alive = true;
    (async () => {
      const [loadedTasks, loadedSettings, seeded] = await Promise.all([
        repo.loadTasks(),
        repo.loadSettings(),
        repo.isSeeded(),
      ]);
      if (!alive) return;
      setSettings(loadedSettings);
      if (!seeded && loadedTasks.length === 0) {
        const seed = seedTasks(todayKey());
        setTasks(seed);
        await repo.markSeeded();
      } else {
        setTasks(loadedTasks);
      }
      didLoad.current = true;
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [repo]);

  // Persist whenever state changes (after the initial load has populated it).
  useEffect(() => {
    if (didLoad.current) repo.saveTasks(tasks);
  }, [tasks, repo]);
  useEffect(() => {
    if (didLoad.current) repo.saveSettings(settings);
  }, [settings, repo]);

  // Expanded instances for a day (single tasks + repeating occurrences).
  const tasksForDay = useCallback((dateKey: string) => expandForDay(tasks, dateKey), [tasks]);

  const saveDraft = useCallback((draft: Draft) => {
    const title = draft.title.trim() === '' ? 'Untitled' : draft.title.trim();
    // A single task with subtasks is complete exactly when all of them are
    // (repeating tasks track that per day, not in the series' template).
    const fix = (t: Task): Task => (!t.repeat && t.subtasks.length ? { ...t, done: t.subtasks.every((x) => x.done) } : t);
    const ticks = (t: Pick<Task, 'subtasks'>) => t.subtasks.map((x) => `${x.id}:${x.done ? 1 : 0}`).join(',');
    setTasks((prev) => {
      if (draft.id) {
        // Only re-derive when the subtasks changed — renaming an older task
        // must not quietly reopen it.
        return prev.map((t) => {
          if (t.id !== draft.id) return t;
          const next = { ...t, ...draft, title } as Task;
          return ticks(next) !== ticks(t) ? fix(next) : next;
        });
      }
      const task: Task = fix({ ...(draft as Omit<Task, 'id'>), title, id: genId() });
      return [...prev, task];
    });
  }, []);

  const deleteTask = useCallback((id: string): Deleted | null => {
    const { baseId } = parseId(id);
    const index = tasksRef.current.findIndex((t) => t.id === baseId);
    if (index < 0) return null;
    const task = tasksRef.current[index];
    setTasks((prev) => prev.filter((t) => t.id !== baseId));
    return { task, index };
  }, []);

  // Put a deleted task back where it was (same id, links and history).
  const restoreTask = useCallback(({ task, index }: Deleted) => {
    setTasks((prev) => (prev.some((t) => t.id === task.id) ? prev : [...prev.slice(0, index), task, ...prev.slice(index)]));
  }, []);

  // Toggle completion — per-occurrence (doneDates) for a repeating instance.
  // With subtasks, completion follows them: a task can't be ticked off while
  // any are open, nor unticked while all are done (the UI explains why; this
  // is the guard).
  const toggleDone = useCallback((id: string) => {
    const { baseId, date } = parseId(id);
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== baseId) return t;
        const locked = t.subtasks.length > 0 && allSubsDone(t, t.repeat ? date : null);
        if (t.repeat && date) {
          const has = t.doneDates.includes(date);
          if (has ? locked : !locked && t.subtasks.length > 0) return t;
          return { ...t, doneDates: has ? t.doneDates.filter((d) => d !== date) : [...t.doneDates, date] };
        }
        if (t.done ? locked : !locked && t.subtasks.length > 0) return t;
        return { ...t, done: !t.done };
      })
    );
  }, []);

  // Set completion outright (e.g. "Done" on a reminder) — finishing a task
  // finishes its subtasks too, so the two never disagree.
  const setDone = useCallback((id: string, done: boolean) => {
    const { baseId, date } = parseId(id);
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== baseId) return t;
        if (t.repeat && date) {
          const has = t.doneDates.includes(date);
          if (has === done) return t;
          if (!done) return { ...t, doneDates: t.doneDates.filter((d) => d !== date) };
          const subDone = t.subtasks.length ? { ...(t.subDone ?? {}), [date]: t.subtasks.map((x) => x.id) } : t.subDone;
          return { ...t, subDone, doneDates: [...t.doneDates, date] };
        }
        if (t.done === done) return t;
        return done ? { ...t, done, subtasks: t.subtasks.map((x) => ({ ...x, done: true })) } : { ...t, done };
      })
    );
  }, []);

  // Tick a subtask. Ticking the last open one completes the task; unticking
  // one of a completed task reopens it. Repeating tasks keep this per day.
  const toggleSubtask = useCallback((taskId: string, subId: string) => {
    const { baseId, date } = parseId(taskId);
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== baseId) return t;
        if (t.repeat && date) {
          const cur = new Set(t.subDone?.[date] ?? []);
          if (cur.has(subId)) cur.delete(subId);
          else cur.add(subId);
          const ids = t.subtasks.map((x) => x.id).filter((x) => cur.has(x));
          const subDone = { ...(t.subDone ?? {}) };
          if (ids.length) subDone[date] = ids;
          else delete subDone[date];
          const all = t.subtasks.length > 0 && ids.length === t.subtasks.length;
          const has = t.doneDates.includes(date);
          const doneDates = all ? (has ? t.doneDates : [...t.doneDates, date]) : t.doneDates.filter((d) => d !== date);
          return { ...t, subDone: Object.keys(subDone).length ? subDone : undefined, doneDates };
        }
        const subtasks = t.subtasks.map((x) => (x.id === subId ? { ...x, done: !x.done } : x));
        return { ...t, subtasks, done: subtasks.every((x) => x.done) };
      })
    );
  }, []);

  const toggleExpanded = useCallback((id: string) => {
    const { baseId } = parseId(id);
    setTasks((prev) => prev.map((t) => (t.id === baseId ? { ...t, expanded: !t.expanded } : t)));
  }, []);

  const toggleStar = useCallback((id: string) => {
    const { baseId } = parseId(id);
    setTasks((prev) => prev.map((t) => (t.id === baseId ? { ...t, starred: !t.starred || undefined } : t)));
  }, []);

  const moveTask = useCallback((id: string, start: number) => {
    const { baseId } = parseId(id);
    setTasks((prev) => prev.map((t) => (t.id === baseId ? { ...t, start } : t)));
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const updateCalendar = useCallback((patch: Partial<CalendarSync>) => {
    setSettings((prev) => ({ ...prev, calendar: { ...prev.calendar, ...patch } }));
  }, []);

  const applyCalendarSync = useCallback((ops: SyncOps, patch: Partial<CalendarSync>) => {
    setTasks((prev) => applyOps(prev, ops));
    if (Object.keys(patch).length) setSettings((prev) => ({ ...prev, calendar: { ...prev.calendar, ...patch } }));
  }, []);

  // Restoring a backup. What belongs to this phone stays: its alarm sound and
  // its calendar sync (which re-matches the restored tasks to their events —
  // and forgets the old ones' links, so nothing is deleted from the calendar).
  const importBackup = useCallback((b: Backup, mode: 'replace' | 'merge'): ImportResult => {
    if (mode === 'replace') {
      const restored = restorePhotos(b);
      setTasks(b.tasks);
      setSettings((prev) => ({ ...restored, alarmSound: prev.alarmSound, calendar: { ...prev.calendar, seen: [] }, lastBackup: prev.lastBackup }));
      return { tasks: b.tasks.length, tags: restored.tags.length, places: restored.places.length };
    }
    // Merge: add the tasks, tags and places that aren't here yet.
    const cur = settingsRef.current;
    const taskIds = new Set(tasksRef.current.map((t) => t.id));
    const newTasks = b.tasks.filter((t) => !taskIds.has(t.id));
    const tagIds = new Set(cur.tags.map((t) => t.id));
    const newTags = b.settings.tags.filter((t) => !tagIds.has(t.id));
    const allTags = new Set([...tagIds, ...newTags.map((t) => t.id)]);
    const placeIds = new Set(cur.places.map((p) => p.id));
    const addPlaces = new Set(b.settings.places.filter((p) => !placeIds.has(p.id)).map((p) => p.id));
    const newPlaces = restorePhotos(b, addPlaces).places.filter((p) => addPlaces.has(p.id));
    setTasks((prev) => {
      const ids = new Set(prev.map((t) => t.id));
      return [...prev, ...newTasks.filter((t) => !ids.has(t.id))];
    });
    setSettings((prev) => ({
      ...prev,
      tags: [...prev.tags, ...newTags.map((t) => (t.parentId && !allTags.has(t.parentId) ? { ...t, parentId: null } : t))],
      places: [...prev.places, ...newPlaces],
    }));
    return { tasks: newTasks.length, tags: newTags.length, places: newPlaces.length };
  }, []);

  const restoreSnapshot = useCallback((s: Snapshot) => {
    setTasks(s.tasks);
    setSettings(s.settings);
  }, []);

  const resetAll = useCallback((): Snapshot => {
    const before = { tasks: tasksRef.current, settings: settingsRef.current };
    setTasks([]);
    setSettings({ ...DEFAULT_SETTINGS, calendar: { ...DEFAULT_CALENDAR } });
    return before;
  }, []);

  const clearCompleted = useCallback((dateKey?: string) => {
    setTasks((prev) => prev.filter((t) => !(t.done && (dateKey ? t.date === dateKey : true))));
  }, []);

  const clearDay = useCallback((dateKey: string) => {
    setTasks((prev) => prev.filter((t) => t.date !== dateKey));
  }, []);

  const clearAll = useCallback(() => setTasks([]), []);

  const addTag = useCallback((name: string, parentId: string | null = null) => {
    const n = name.trim();
    if (!n) return;
    setSettings((prev) => {
      const palette = prev.colors.length ? prev.colors : COLORS;
      const color = parentId
        ? prev.tags.find((t) => t.id === parentId)?.color || '#5B9DF9'
        : palette[prev.tags.filter((t) => !t.parentId).length % palette.length];
      return { ...prev, tags: [...prev.tags, { id: genId(), name: n, parentId, color }] };
    });
  }, []);

  const renameTag = useCallback((id: string, name: string) => {
    const n = name.trim();
    if (!n) return;
    setSettings((prev) => ({ ...prev, tags: prev.tags.map((t) => (t.id === id ? { ...t, name: n } : t)) }));
  }, []);

  const setTagColor = useCallback((id: string, color: string) => {
    setSettings((prev) => ({ ...prev, tags: prev.tags.map((t) => (t.id === id ? { ...t, color } : t)) }));
  }, []);

  const setTagHideDots = useCallback((id: string, hide: boolean) => {
    setSettings((prev) => ({ ...prev, tags: prev.tags.map((t) => (t.id === id ? { ...t, hideDots: hide } : t)) }));
  }, []);

  const setTagIcon = useCallback((id: string, icon: string | null) => {
    setSettings((prev) => ({ ...prev, tags: prev.tags.map((t) => (t.id === id ? { ...t, icon: icon || undefined } : t)) }));
  }, []);

  const setTagIntensity = useCallback((id: string, intensity: ReminderIntensity | null) => {
    setSettings((prev) => ({ ...prev, tags: prev.tags.map((t) => (t.id === id ? { ...t, intensity: intensity ?? undefined } : t)) }));
  }, []);

  const deleteTag = useCallback((id: string) => {
    // Removed = the tag plus any of its sub-tags.
    const removed = new Set<string>([id]);
    settingsRef.current.tags.forEach((t) => {
      if (t.parentId === id) removed.add(t.id);
    });
    setSettings((prev) => ({ ...prev, tags: prev.tags.filter((t) => !removed.has(t.id)) }));
    setTasks((prev) => prev.map((t) => (t.tagId && removed.has(t.tagId) ? { ...t, tagId: null } : t)));
  }, []);

  const addPlace = useCallback((name: string, tagId: string | null = null) => {
    const n = name.trim();
    if (!n) return;
    setSettings((prev) => ({ ...prev, places: [...prev.places, { id: genId(), name: n, tagId, link: '', photoUri: null, lat: null, lng: null, address: '' }] }));
  }, []);

  const renamePlace = useCallback((id: string, name: string) => {
    const n = name.trim();
    if (!n) return;
    setSettings((prev) => ({ ...prev, places: prev.places.map((p) => (p.id === id ? { ...p, name: n } : p)) }));
  }, []);

  const setPlaceTag = useCallback((id: string, tagId: string | null) => {
    setSettings((prev) => ({ ...prev, places: prev.places.map((p) => (p.id === id ? { ...p, tagId } : p)) }));
  }, []);
  const setPlaceLink = useCallback((id: string, link: string) => {
    setSettings((prev) => ({ ...prev, places: prev.places.map((p) => (p.id === id ? { ...p, link } : p)) }));
  }, []);
  const setPlacePhoto = useCallback((id: string, photoUri: string | null) => {
    setSettings((prev) => ({ ...prev, places: prev.places.map((p) => (p.id === id ? { ...p, photoUri } : p)) }));
  }, []);
  const setPlaceLocation = useCallback((id: string, loc: PlaceLocation | null) => {
    setSettings((prev) => ({
      ...prev,
      places: prev.places.map((p) => (p.id === id ? { ...p, link: loc?.link ?? '', lat: loc?.lat ?? null, lng: loc?.lng ?? null, address: loc?.address ?? '' } : p)),
    }));
  }, []);

  const deletePlace = useCallback((id: string) => {
    setSettings((prev) => ({ ...prev, places: prev.places.filter((p) => p.id !== id) }));
    setTasks((prev) => prev.map((t) => (t.placeId === id ? { ...t, placeId: null } : t)));
  }, []);

  const value: Ctx = {
    loaded,
    tasks,
    settings,
    tasksForDay,
    saveDraft,
    deleteTask,
    restoreTask,
    toggleDone,
    setDone,
    toggleSubtask,
    toggleExpanded,
    toggleStar,
    moveTask,
    updateSettings,
    updateCalendar,
    applyCalendarSync,
    importBackup,
    restoreSnapshot,
    resetAll,
    clearCompleted,
    clearDay,
    clearAll,
    addTag,
    renameTag,
    setTagColor,
    setTagHideDots,
    setTagIcon,
    setTagIntensity,
    deleteTag,
    addPlace,
    renamePlace,
    setPlaceTag,
    setPlaceLink,
    setPlacePhoto,
    setPlaceLocation,
    deletePlace,
  };

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp(): Ctx {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
