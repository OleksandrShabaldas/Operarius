import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import Animated, { SlideInRight, SlideOutRight } from 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { C } from './src/theme';
import { AppProvider, useApp } from './src/store';
import { Draft, TaskType } from './src/types';
import { todayKey } from './src/utils';
import { TodayScreen } from './src/screens/TodayScreen';
import { TodoScreen } from './src/screens/TodoScreen';
import { StatsScreen } from './src/screens/StatsScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { BottomNav, Tab } from './src/components/BottomNav';
import { TaskEditorSheet } from './src/components/TaskEditorSheet';
import { TaskInfoSheet } from './src/components/TaskInfoSheet';
import { UpdateModal } from './src/components/UpdateModal';
import { checkForUpdate, currentVersion, ReleaseInfo } from './src/updater';

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
  const { loaded, tasks, settings, tasksForDay, saveDraft, deleteTask, toggleDone, toggleSubtask } = app;

  const [tab, setTab] = useState<Tab>('today');
  const [overlay, setOverlay] = useState<'stats' | 'settings' | null>(null);
  const [selectedKey, setSelectedKey] = useState<string>(todayKey());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);

  const [update, setUpdate] = useState<ReleaseInfo | null>(null);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const curVer = currentVersion();

  const runUpdateCheck = useCallback(async (manual: boolean) => {
    setChecking(true);
    const r = await checkForUpdate();
    setChecking(false);
    if (r.available && r.release) {
      setOverlay(null);
      setUpdate(r.release);
      setUpdateOpen(true);
    } else if (manual) {
      if (r.release) Alert.alert('Up to date', `You're on the latest version (v${r.current}).`);
      else Alert.alert('Check for updates', "Couldn't reach GitHub. Check your connection and try again.");
    }
  }, []);

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync().catch(() => {});
  }, [loaded]);

  const didCheck = useRef(false);
  useEffect(() => {
    if (loaded && !didCheck.current) {
      didCheck.current = true;
      const t = setTimeout(() => runUpdateCheck(false), 1200);
      return () => clearTimeout(t);
    }
  }, [loaded, runUpdateCheck]);

  const openNew = useCallback(
    (opts?: { startMin?: number; type?: TaskType }) => {
      const type: TaskType = opts?.type ?? (tab === 'todo' ? 'todo' : 'planned');
      const dayPlanned = tasksForDay(selectedKey).filter((t) => t.type === 'planned');
      const after = dayPlanned.reduce((m, t) => Math.max(m, t.start + t.dur), settings.dayStart);
      const start = Math.min(opts?.startMin ?? after, settings.dayEnd - 30);
      setDraft({
        title: '',
        emoji: '📝',
        color: '#5B9DF9',
        type,
        start,
        dur: 30,
        done: false,
        tagId: null,
        placeId: null,
        date: type === 'todo' ? null : selectedKey,
        notes: '',
        subtasks: [],
      });
    },
    [tab, selectedKey, settings.dayStart, settings.dayEnd, tasksForDay]
  );

  const editFromInfo = useCallback(() => {
    setViewId((id) => {
      const t = id ? tasks.find((x) => x.id === id) : null;
      if (t) setDraft({ ...t });
      return null;
    });
  }, [tasks]);

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

  const viewTask = viewId ? tasks.find((t) => t.id === viewId) ?? null : null;

  return (
    <View style={styles.bg}>
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
        />
      ) : (
        <TodoScreen onOpenInfo={setViewId} onOpenStats={() => setOverlay('stats')} onOpenSettings={() => setOverlay('settings')} />
      )}
      <BottomNav tab={tab} onTab={setTab} onAdd={() => openNew()} />

      {/* Pushed screens — slide in/out over the tabs */}
      {overlay === 'stats' && (
        <Animated.View entering={SlideInRight.duration(300)} exiting={SlideOutRight.duration(260)} style={styles.overlay}>
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
        <Animated.View entering={SlideInRight.duration(300)} exiting={SlideOutRight.duration(260)} style={styles.overlay}>
          <SettingsScreen onClose={() => setOverlay(null)} onCheckUpdates={() => runUpdateCheck(true)} checkingUpdates={checking} currentVersion={curVer} />
        </Animated.View>
      )}

      <TaskInfoSheet
        task={viewTask}
        tags={settings.tags}
        places={settings.places}
        clock={settings.clock}
        onEdit={editFromInfo}
        onToggleDone={() => viewTask && toggleDone(viewTask.id)}
        onToggleSubtask={(subId) => viewTask && toggleSubtask(viewTask.id, subId)}
        onClose={() => setViewId(null)}
      />

      <TaskEditorSheet
        draft={draft}
        tags={settings.tags}
        places={settings.places}
        clock={settings.clock}
        weekStart={settings.weekStart}
        timePresets={settings.timePresets}
        durationPresets={settings.durationPresets}
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
      <SafeAreaProvider>
        <AppProvider>
          <Root />
        </AppProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: C.bg },
  fill: { flex: 1 },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: C.bg },
  glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 340, pointerEvents: 'none' },
});
