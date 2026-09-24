import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, BackHandler, Linking, StyleSheet, View } from 'react-native';
import Animated, { ReducedMotionConfig, ReduceMotion, SlideInRight, SlideOutRight } from 'react-native-reanimated';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { C } from './src/theme';
import { ms, setMotion } from './src/motion';
import { AppProvider, useApp } from './src/store';
import { Draft, TaskType } from './src/types';
import { occurrence, parseId } from './src/recurrence';
import { todayKey } from './src/utils';
import { carryReminders, defaultReminders, useReminderSync } from './src/reminders';
import { useCalendarSync } from './src/calendarSync';
import { useWidgetSync } from './src/widgets';
import { TodayScreen } from './src/screens/TodayScreen';
import { TodoScreen } from './src/screens/TodoScreen';
import { StatsScreen } from './src/screens/StatsScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { BottomNav, Tab } from './src/components/BottomNav';
import { TaskEditorSheet } from './src/components/TaskEditorSheet';
import { TaskInfoSheet } from './src/components/TaskInfoSheet';
import { UpdateModal } from './src/components/UpdateModal';
import { checkForUpdate, currentVersion, ReleaseInfo } from './src/updater';

const DAY_MIN = 24 * 60;

SplashScreen.preventAutoHideAsync().catch(() => {});

function BackgroundGlow() {
  return (
    <Svg style={styles.glow}>
      <Defs>
        <RadialGradient id="g1" cx="22%" cy="8%" r="42%">
          <Stop offset="0" stopColor="#7c7cf0" stopOpacity={0.28} />
          <Stop offset="1" stopColor="#7c7cf0" stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id="g2" cx="88%" cy="6%" r="40%">
          <Stop offset="0" stopColor="#4fd1c5" stopOpacity={0.2} />
          <Stop offset="1" stopColor="#4fd1c5" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#g1)" />
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#g2)" />
    </Svg>
  );
}

function Root() {
  const app = useApp();
  const { loaded, tasks, settings, tasksForDay, saveDraft, deleteTask, toggleDone, setDone, toggleSubtask, toggleStar, applyCalendarSync } = app;

  const [tab, setTab] = useState<Tab>('today');
  const [overlay, setOverlay] = useState<'stats' | 'settings' | null>(null);
  const [selectedKey, setSelectedKey] = useState<string>(todayKey());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [autoDate, setAutoDate] = useState(false); // open the editor straight into the date picker (copy flow)
  const [draftTouched, setDraftTouched] = useState<(keyof Draft)[]>([]); // fields the opener set on purpose
  const [viewId, setViewId] = useState<string | null>(null);
  const [todayPing, setTodayPing] = useState(0); // re-tapping the Today tab → jump to today

  const [update, setUpdate] = useState<ReleaseInfo | null>(null);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [updateWaiting, setUpdateWaiting] = useState(false); // found on its own: shown once nothing else is open
  const [checking, setChecking] = useState(false);
  const curVer = currentVersion();

  // Apply the animation settings before any child starts an animation (layout
  // effects run before every passive effect in the tree).
  useLayoutEffect(() => {
    setMotion(settings.animations, settings.animSpeed);
  }, [settings.animations, settings.animSpeed]);

  const runUpdateCheck = useCallback(async (manual: boolean) => {
    setChecking(true);
    const r = await checkForUpdate();
    setChecking(false);
    if (r.available && r.release) {
      setUpdate(r.release);
      if (manual) {
        setOverlay(null);
        setUpdateOpen(true);
      } else setUpdateWaiting(true);
    } else if (manual) {
      if (r.release) Alert.alert('Up to date', `You're on the latest version (v${r.current}).`);
      else Alert.alert('Check for updates', "Couldn't reach GitHub. Check your connection and try again.");
    }
  }, []);

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync().catch(() => {});
  }, [loaded]);

  // An update found in the background waits until no task, editor or pushed
  // screen is open (e.g. the app was opened on a task from a reminder or a
  // widget), then comes up a moment later.
  useEffect(() => {
    if (!updateWaiting || viewId || draft || overlay) return;
    const t = setTimeout(() => {
      setUpdateWaiting(false);
      setUpdateOpen(true);
    }, 600);
    return () => clearTimeout(t);
  }, [updateWaiting, viewId, draft, overlay]);

  // Reminders: keep the phone's alarms matching the tasks, and apply "Done"
  // pressed on a notification / the reminder screen while the app was closed.
  useReminderSync({ loaded, tasks, settings, onDone: (key) => setDone(key, true) });

  // Google Calendar: keep tasks and the chosen calendar in step (Settings → Google Calendar).
  useCalendarSync({ loaded, tasks, settings, apply: applyCalendarSync });

  // Home-screen widgets: today's timeline and the month.
  useWidgetSync({ loaded, tasks, settings });

  // Links into the app — from a reminder, "Open task" on its screen, or a
  // widget: operarius://task?key=<task>&date=<day> opens a task,
  // operarius://day?date=<day> a day, operarius://new?date=<day> a new task.
  const linkRef = useRef({ tasks, openNew: (_?: { startMin?: number; dur?: number; type?: TaskType }) => {} });
  linkRef.current.tasks = tasks;
  const openFromLink = useCallback((url: string | null) => {
    if (!url || !url.startsWith('operarius://')) return;
    const q = url.split('?')[1] ?? '';
    const params: Record<string, string> = {};
    q.split('&').forEach((kv) => {
      const [k, v] = kv.split('=');
      if (k) params[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
    });
    const date = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? '') ? params.date : todayKey();
    if (url.startsWith('operarius://day') || url.startsWith('operarius://new')) {
      setOverlay(null);
      setViewId(null);
      setTab('today');
      setSelectedKey(date);
      // A new task: once the day is there, open the editor on it.
      if (url.startsWith('operarius://new')) setTimeout(() => linkRef.current.openNew(), ms(360) + 60);
      return;
    }
    if (!url.startsWith('operarius://task')) return;
    const key = params.key;
    if (!key) return;
    const base = linkRef.current.tasks.find((t) => t.id === parseId(key).baseId);
    if (!base) return;
    setOverlay(null);
    if (base.type === 'todo') setTab('todo');
    else {
      setTab('today');
      setSelectedKey(params.date || base.date || todayKey());
    }
    // Let the day land first, then open the task's info.
    setTimeout(() => setViewId(key), ms(360) + 60);
  }, []);
  const didLink = useRef(false);
  useEffect(() => {
    if (!loaded) return;
    if (!didLink.current) {
      didLink.current = true;
      Linking.getInitialURL().then(openFromLink).catch(() => {});
    }
    const sub = Linking.addEventListener('url', (e) => openFromLink(e.url));
    return () => sub.remove();
  }, [loaded, openFromLink]);

  // Android hardware back: close overlays / return to Today before exiting.
  // (Modals — editor, info, pickers — consume back via their own onRequestClose.)
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (overlay) {
        setOverlay(null);
        return true;
      }
      if (tab !== 'today') {
        setTab('today');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [overlay, tab]);

  const didCheck = useRef(false);
  useEffect(() => {
    if (loaded && !didCheck.current) {
      didCheck.current = true;
      const t = setTimeout(() => runUpdateCheck(false), 1200);
      return () => clearTimeout(t);
    }
  }, [loaded, runUpdateCheck]);

  const openNew = useCallback(
    (opts?: { startMin?: number; dur?: number; type?: TaskType }) => {
      setAutoDate(false);
      const type: TaskType = opts?.type ?? (tab === 'todo' ? 'todo' : 'planned');
      // A tapped free gap sets the time (and length), and the To-do tab /
      // All-day button the type, on purpose — a name suggestion must not
      // override those.
      const set: (keyof Draft)[] = [];
      if (opts?.startMin != null) set.push('start');
      if (opts?.dur != null) set.push('dur');
      if (opts?.type || tab === 'todo') set.push('type');
      setDraftTouched(set);
      // "+" starts the task now (to the nearest 5 minutes, the pickers' step).
      const d = new Date();
      const now = Math.round((d.getHours() * 60 + d.getMinutes()) / 5) * 5;
      const start = Math.max(0, Math.min(opts?.startMin ?? now, DAY_MIN - 5));
      const dur = Math.max(5, Math.min(opts?.dur ?? 30, DAY_MIN - start));
      setDraft({
        title: '',
        emoji: '📝',
        color: '#5B9DF9',
        type,
        start,
        dur,
        done: false,
        tagId: null,
        placeId: null,
        date: type === 'todo' ? null : selectedKey,
        notes: '',
        subtasks: [],
        repeat: null,
        doneDates: [],
        expanded: false,
        reminders: defaultReminders(settings), // Settings → Reminders → New tasks
      });
    },
    [tab, selectedKey, settings]
  );

  // Close the info sheet first, then open the editor a beat later, so the two
  // bottom-sheet modals never transition at the same time (which on Android can
  // drop the touch and leave nothing open).
  const editFromInfo = useCallback(() => {
    if (!viewId) return;
    const base = tasks.find((x) => x.id === parseId(viewId).baseId);
    setAutoDate(false);
    setDraftTouched([]);
    setViewId(null);
    if (base) setTimeout(() => setDraft({ ...base }), ms(230) + 30); // editing a repeat edits the series
  }, [viewId, tasks]);

  // Copy an existing task into a fresh draft (no id → new task) and jump the
  // editor straight to the date picker so you choose the new day right away.
  const copyFromInfo = useCallback(() => {
    if (!viewId) return;
    const base = tasks.find((x) => x.id === parseId(viewId).baseId);
    setViewId(null);
    if (base) {
      const { id: _id, done: _done, doneDates: _dd, subDone: _sd, ...rest } = base;
      setAutoDate(true);
      setDraftTouched(['emoji', 'color', 'type', 'start', 'dur', 'tagId', 'placeId', 'notes', 'subtasks', 'repeat', 'reminders']);
      // Reminders come along — the relative ones, and custom ones still ahead.
      const reminders = carryReminders(base.reminders);
      setTimeout(() => setDraft({ ...rest, done: false, doneDates: [], expanded: false, reminders, subtasks: base.subtasks.map((s) => ({ ...s, done: false })) }), ms(230) + 30);
    }
  }, [viewId, tasks]);

  linkRef.current.openNew = openNew;

  const patch = useCallback((p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d)), []);
  const save = useCallback(() => {
    setDraft((d) => {
      if (d) saveDraft(d);
      return null;
    });
  }, [saveDraft]);
  const del = useCallback(() => {
    setDraft((d) => {
      if (d?.id) deleteTask(d.id);
      return null;
    });
  }, [deleteTask]);

  if (!loaded) return <View style={styles.bg} />;

  // Other planned tasks on the draft's day, so the duration picker can offer
  // "after previous task" / "until next task" (named, with their times).
  const editorSiblings =
    draft && draft.type === 'planned' && draft.date
      ? tasksForDay(draft.date)
          .filter((t) => t.type === 'planned' && parseId(t.id).baseId !== draft.id)
          .map((t) => ({ id: t.id, start: t.start, dur: t.dur, title: t.title, color: t.color }))
      : [];

  // Resolve the info-sheet target — a repeating occurrence is reconstructed
  // from its base with the right date and per-occurrence done state.
  let viewTask = null as (typeof tasks)[number] | null;
  if (viewId) {
    const { baseId, date } = parseId(viewId);
    const base = tasks.find((t) => t.id === baseId) || null;
    viewTask = base && base.repeat && date ? occurrence(base, date) : base;
  }

  return (
    <View style={styles.bg}>
      {/* Animations off → every Reanimated animation (incl. layout ones) finishes instantly. */}
      <ReducedMotionConfig mode={settings.animations ? ReduceMotion.System : ReduceMotion.Always} />
      <BackgroundGlow />

      {/* Base tabs — each screen's list staggers in on mount */}
      {tab === 'today' ? (
        <TodayScreen
          selectedKey={selectedKey}
          setSelectedKey={setSelectedKey}
          onOpenStats={() => setOverlay('stats')}
          onOpenSettings={() => setOverlay('settings')}
          onNewTask={openNew}
          onOpenInfo={setViewId}
          todayPing={todayPing}
        />
      ) : (
        <TodoScreen onOpenInfo={setViewId} onOpenStats={() => setOverlay('stats')} onOpenSettings={() => setOverlay('settings')} />
      )}
      <BottomNav
        tab={tab}
        onTab={(t) => {
          if (t === 'today' && tab === 'today') setTodayPing((n) => n + 1);
          setTab(t);
        }}
        onAdd={() => openNew()}
      />

      {/* Pushed screens — slide in/out over the tabs */}
      {overlay === 'stats' && (
        <Animated.View entering={SlideInRight.duration(ms(300))} exiting={SlideOutRight.duration(ms(260))} style={styles.overlay}>
          <StatsScreen
            onClose={() => setOverlay(null)}
            onPickDay={(key) => {
              setSelectedKey(key);
              setTab('today');
              setOverlay(null);
            }}
          />
        </Animated.View>
      )}
      {overlay === 'settings' && (
        <Animated.View entering={SlideInRight.duration(ms(300))} exiting={SlideOutRight.duration(ms(260))} style={styles.overlay}>
          <SettingsScreen onClose={() => setOverlay(null)} onCheckUpdates={() => runUpdateCheck(true)} checkingUpdates={checking} currentVersion={curVer} />
        </Animated.View>
      )}

      <TaskInfoSheet
        task={viewTask}
        tags={settings.tags}
        places={settings.places}
        clock={settings.clock}
        onEdit={editFromInfo}
        onCopy={copyFromInfo}
        onToggleDone={() => viewTask && toggleDone(viewTask.id)}
        onToggleSubtask={(subId) => viewTask && toggleSubtask(viewTask.id, subId)}
        onToggleStar={() => viewTask && toggleStar(viewTask.id)}
        onClose={() => setViewId(null)}
      />

      <TaskEditorSheet
        draft={draft}
        library={tasks}
        initialTouched={draftTouched}
        tags={settings.tags}
        places={settings.places}
        clock={settings.clock}
        weekStart={settings.weekStart}
        timePresets={settings.timePresets}
        durationPresets={settings.durationPresets}
        colors={settings.colors}
        emojis={settings.emojis}
        siblings={editorSiblings}
        dayStart={settings.dayStart}
        dayEnd={settings.dayEnd}
        autoPickDate={autoDate}
        onPatch={patch}
        onSave={save}
        onDelete={del}
        onClose={() => setDraft(null)}
      />

      <UpdateModal release={updateOpen ? update : null} currentVersion={curVer} onClose={() => setUpdateOpen(false)} />

      <StatusBar style="light" />
    </View>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
        <SafeAreaProvider>
          <AppProvider>
            <Root />
          </AppProvider>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: C.bg },
  fill: { flex: 1 },
  // Pushed screens sit above everything on the base tabs (explicit zIndex so no
  // floating element of a tab can ever draw over them).
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: C.bg, zIndex: 100 },
  glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 340, pointerEvents: 'none' },
});
