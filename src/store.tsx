import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Draft, Settings, Task } from './types';
import { DEFAULT_SETTINGS, localRepository, Repository, seedTasks } from './storage';
import { genId, todayKey } from './utils';

type Ctx = {
  loaded: boolean;
  tasks: Task[];
  settings: Settings;
  tasksForDay: (dateKey: string) => Task[];
  saveDraft: (draft: Draft) => void; // add when no id, else update
  deleteTask: (id: string) => void;
  toggleDone: (id: string) => void;
  moveTask: (id: string, start: number) => void; // commit a drag
  updateSettings: (patch: Partial<Settings>) => void;
  clearCompleted: (dateKey?: string) => void; // all days if omitted
  clearDay: (dateKey: string) => void;
  clearAll: () => void;
  // Tags & places
  addTag: (name: string, parentId?: string | null) => void;
  renameTag: (id: string, name: string) => void;
  deleteTag: (id: string) => void;
  addPlace: (name: string) => void;
  renamePlace: (id: string, name: string) => void;
  deletePlace: (id: string) => void;
};

const AppCtx = createContext<Ctx | null>(null);

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

  const tasksForDay = useCallback(
    (dateKey: string) => tasks.filter((t) => t.date === dateKey),
    [tasks]
  );

  const saveDraft = useCallback((draft: Draft) => {
    const title = draft.title.trim() === '' ? 'Untitled' : draft.title.trim();
    setTasks((prev) => {
      if (draft.id) {
        return prev.map((t) => (t.id === draft.id ? ({ ...t, ...draft, title } as Task) : t));
      }
      const task: Task = { ...(draft as Omit<Task, 'id'>), title, id: genId() };
      return [...prev, task];
    });
  }, []);

  const deleteTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toggleDone = useCallback((id: string) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  }, []);

  const moveTask = useCallback((id: string, start: number) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, start } : t)));
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
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
    setSettings((prev) => ({ ...prev, tags: [...prev.tags, { id: genId(), name: n, parentId }] }));
  }, []);

  const renameTag = useCallback((id: string, name: string) => {
    const n = name.trim();
    if (!n) return;
    setSettings((prev) => ({ ...prev, tags: prev.tags.map((t) => (t.id === id ? { ...t, name: n } : t)) }));
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

  const addPlace = useCallback((name: string) => {
    const n = name.trim();
    if (!n) return;
    setSettings((prev) => ({ ...prev, places: [...prev.places, { id: genId(), name: n }] }));
  }, []);

  const renamePlace = useCallback((id: string, name: string) => {
    const n = name.trim();
    if (!n) return;
    setSettings((prev) => ({ ...prev, places: prev.places.map((p) => (p.id === id ? { ...p, name: n } : p)) }));
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
    toggleDone,
    moveTask,
    updateSettings,
    clearCompleted,
    clearDay,
    clearAll,
    addTag,
    renameTag,
    deleteTag,
    addPlace,
    renamePlace,
    deletePlace,
  };

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp(): Ctx {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
