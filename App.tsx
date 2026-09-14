import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { C } from './src/theme';
import { AppProvider, useApp } from './src/store';
import { Draft } from './src/types';
import { todayKey } from './src/utils';
import { TodayScreen } from './src/screens/TodayScreen';
import { StatsScreen } from './src/screens/StatsScreen';
import { BottomNav, Tab } from './src/components/BottomNav';
import { TaskEditorSheet } from './src/components/TaskEditorSheet';
import { SettingsSheet } from './src/components/SettingsSheet';
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
  const { loaded, settings, tasksForDay, saveDraft, deleteTask, updateSettings, clearCompleted, clearAll } = app;

  const [tab, setTab] = useState<Tab>('today');
  const [selectedKey, setSelectedKey] = useState<string>(todayKey());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // Self-update state.
  const [update, setUpdate] = useState<ReleaseInfo | null>(null);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const curVer = currentVersion();

  const runUpdateCheck = useCallback(async (manual: boolean) => {
    setChecking(true);
    const r = await checkForUpdate();
    setChecking(false);
    if (r.available && r.release) {
      setMenuOpen(false);
      setUpdate(r.release);
      setUpdateOpen(true);
    } else if (manual) {
      if (r.release) {
        Alert.alert('Up to date', `You're on the latest version (v${r.current}).`);
      } else {
        Alert.alert('Check for updates', "Couldn't reach GitHub. Check your connection and try again.");
      }
    }
  }, []);

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync().catch(() => {});
  }, [loaded]);

  // One automatic check shortly after the app is ready.
  const didCheck = useRef(false);
  useEffect(() => {
    if (loaded && !didCheck.current) {
      didCheck.current = true;
      const t = setTimeout(() => runUpdateCheck(false), 1200);
      return () => clearTimeout(t);
    }
  }, [loaded, runUpdateCheck]);

  const openNew = useCallback(
    (startMin?: number) => {
      const dayTasks = tasksForDay(selectedKey);
      const after = dayTasks.reduce((m, t) => Math.max(m, t.start + t.dur), settings.dayStart);
      const start = Math.min(startMin ?? after, settings.dayEnd - 30);
      setDraft({
        title: '',
        emoji: '📝',
        color: '#5B9DF9',
        start,
        dur: 30,
        done: false,
        tag: '',
        date: selectedKey,
      });
    },
    [selectedKey, settings.dayStart, settings.dayEnd, tasksForDay]
  );

  const openEdit = useCallback(
    (id: string) => {
      const t = tasksForDay(selectedKey).find((x) => x.id === id);
      if (t) setDraft({ ...t });
    },
    [selectedKey, tasksForDay]
  );

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

  return (
    <View style={styles.bg}>
      <BackgroundGlow />
      {tab === 'today' ? (
        <TodayScreen
          selectedKey={selectedKey}
          setSelectedKey={setSelectedKey}
          onOpenMenu={() => setMenuOpen(true)}
          onNewTask={openNew}
          onEditTask={openEdit}
        />
      ) : (
        <StatsScreen
          onPickDay={(key, t) => {
            setSelectedKey(key);
            setTab(t);
          }}
        />
      )}

      <BottomNav tab={tab} onTab={setTab} onAdd={() => openNew()} />

      <TaskEditorSheet
        draft={draft}
        dayStart={settings.dayStart}
        dayEnd={settings.dayEnd}
        onPatch={patch}
        onSave={save}
        onDelete={del}
        onClose={() => setDraft(null)}
      />

      <SettingsSheet
        visible={menuOpen}
        settings={settings}
        currentVersion={curVer}
        checkingUpdates={checking}
        onCheckUpdates={() => runUpdateCheck(true)}
        onPatch={updateSettings}
        onClearCompleted={() => clearCompleted()}
        onClearAll={clearAll}
        onClose={() => setMenuOpen(false)}
      />

      <UpdateModal
        release={updateOpen ? update : null}
        currentVersion={curVer}
        onClose={() => setUpdateOpen(false)}
      />

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
  glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 340, pointerEvents: 'none' },
});
