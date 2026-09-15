import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, PX, TOPBAND } from '../theme';
import { TaskType } from '../types';
import { useApp } from '../store';
import { addDays, headerParts, hexA, todayKey } from '../utils';
import { WeekStrip } from '../components/WeekStrip';
import { Timeline } from '../components/Timeline';
import { Tappable } from '../components/anim';

type Props = {
  selectedKey: string;
  setSelectedKey: (key: string) => void;
  onOpenStats: () => void;
  onOpenSettings: () => void;
  onNewTask: (opts?: { startMin?: number; type?: TaskType }) => void;
  onOpenInfo: (id: string) => void;
};

function useNowMinute(): number {
  const [m, setM] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });
  useEffect(() => {
    const t = setInterval(() => {
      const d = new Date();
      setM(d.getHours() * 60 + d.getMinutes());
    }, 30000);
    return () => clearInterval(t);
  }, []);
  return m;
}

export function TodayScreen({ selectedKey, setSelectedKey, onOpenStats, onOpenSettings, onNewTask, onOpenInfo }: Props) {
  const insets = useSafeAreaInsets();
  const { tasks, settings, tasksForDay, toggleDone, moveTask } = useApp();
  const nowMin = useNowMinute();
  const [viewportH, setViewportH] = useState(560);

  const dayTasks = tasksForDay(selectedKey);
  const planned = dayTasks.filter((t) => t.type === 'planned');
  const allday = dayTasks.filter((t) => t.type === 'allday');
  const { dayNum, weekday, month } = headerParts(selectedKey);
  const isToday = selectedKey === todayKey();
  const daysWithTasks = useMemo(() => new Set(tasks.filter((t) => t.date).map((t) => t.date as string)), [tasks]);

  const [drag, setDrag] = useState<{ id: string; min: number } | null>(null);
  const dragMinRef = useRef(0);
  const onDragStart = (id: string) => {
    const t = planned.find((x) => x.id === id);
    const start = t ? t.start : 0;
    dragMinRef.current = start;
    setDrag({ id, min: start });
  };
  const onDragMove = (id: string, min: number) => {
    dragMinRef.current = min;
    setDrag((d) => (d && d.id === id ? { id, min } : d));
  };
  const onDragEnd = (id: string) => {
    const min = dragMinRef.current;
    setDrag((d) => {
      if (d && d.id === id && min !== (planned.find((x) => x.id === id)?.start ?? min)) moveTask(id, min);
      return null;
    });
  };

  const scrollRef = useRef<ScrollView>(null);
  const didScroll = useRef(false);
  useEffect(() => {
    if (isToday && !didScroll.current) {
      didScroll.current = true;
      const y = Math.max(0, (nowMin - settings.dayStart) * PX + TOPBAND - 180);
      setTimeout(() => scrollRef.current?.scrollTo({ y, animated: false }), 60);
    }
  }, [isToday, nowMin, settings.dayStart]);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <View style={styles.headerRow}>
          <View style={styles.dateRow}>
            <Text style={styles.dayNum}>{dayNum}</Text>
            <Text style={styles.weekday}>{weekday}</Text>
            <Text style={styles.month}>{month}</Text>
          </View>
          <View style={styles.headBtns}>
            <Tappable style={styles.headBtn} onPress={onOpenStats} hitSlop={6}>
              <Feather name="bar-chart-2" size={17} color={C.textDim} />
            </Tappable>
            <Tappable style={styles.headBtn} onPress={onOpenSettings} hitSlop={6}>
              <Feather name="menu" size={17} color={C.textDim} />
            </Tappable>
          </View>
        </View>

        <WeekStrip
          selectedKey={selectedKey}
          weekStart={settings.weekStart}
          daysWithTasks={daysWithTasks}
          onSelect={setSelectedKey}
          onPageWeek={(delta) => setSelectedKey(addDays(selectedKey, delta * 7))}
        />
      </View>

      {/* All-day tasks (shown only when the day has any) */}
      {allday.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.alldayScroll} contentContainerStyle={styles.alldayRow}>
          {allday.map((t) => (
            <Tappable key={t.id} style={styles.alldayCard} onPress={() => onOpenInfo(t.id)}>
              <LinearGradient colors={[t.color, hexA(t.color, 0.72)]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={styles.alldayIcon}>
                <Text style={styles.alldayEmoji}>{t.emoji}</Text>
              </LinearGradient>
              <Text style={[styles.alldayTitle, t.done && styles.strike]} numberOfLines={1}>{t.title}</Text>
            </Tappable>
          ))}
          <Tappable style={styles.alldayAdd} onPress={() => onNewTask({ type: 'allday' })}>
            <Feather name="plus" size={16} color={C.muted} />
            <Text style={styles.alldayAddTxt}>All-day</Text>
          </Tappable>
        </ScrollView>
      )}

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        onLayout={(e) => setViewportH(e.nativeEvent.layout.height)}
        contentContainerStyle={{ paddingTop: 4 }}
        showsVerticalScrollIndicator={false}>
        <Timeline
          tasks={planned}
          tags={settings.tags}
          places={settings.places}
          clock={settings.clock}
          dayStart={settings.dayStart}
          dayEnd={settings.dayEnd}
          gapThreshold={settings.gapThreshold}
          viewportH={viewportH}
          nowMin={isToday ? nowMin : null}
          dragId={drag?.id ?? null}
          dragMin={drag?.min ?? 0}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
          onOpen={onOpenInfo}
          onToggle={toggleDone}
          onAddAt={(startMin) => onNewTask({ startMin, type: 'planned' })}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 22, paddingBottom: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  dateRow: { flexDirection: 'row', alignItems: 'baseline', gap: 9 },
  dayNum: { fontSize: 38, fontWeight: '700', letterSpacing: -1, color: C.text, lineHeight: 40 },
  weekday: { fontSize: 22, fontWeight: '600', color: '#e8e8ec', letterSpacing: -0.4 },
  month: { fontSize: 15, fontWeight: '500', color: '#7a7a82', marginLeft: 2 },
  headBtns: { flexDirection: 'row', gap: 10 },
  headBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  alldayScroll: { maxHeight: 56, flexGrow: 0 },
  alldayRow: { paddingHorizontal: 20, paddingVertical: 6, gap: 8, alignItems: 'center' },
  alldayCard: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.card, borderRadius: 12, paddingLeft: 6, paddingRight: 12, paddingVertical: 6, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)' },
  alldayIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  alldayEmoji: { fontSize: 15 },
  alldayTitle: { fontSize: 13.5, fontWeight: '600', color: C.text, maxWidth: 150 },
  strike: { textDecorationLine: 'line-through', color: '#6a6a72' },
  alldayAdd: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: 'rgba(255,255,255,0.04)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)' },
  alldayAddTxt: { fontSize: 13, fontWeight: '600', color: C.muted },
  scroll: { flex: 1 },
});
