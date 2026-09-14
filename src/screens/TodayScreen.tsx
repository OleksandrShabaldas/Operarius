import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, PX, TOPBAND } from '../theme';
import { useApp } from '../store';
import { addDays, headerParts, todayKey } from '../utils';
import { WeekStrip } from '../components/WeekStrip';
import { Timeline } from '../components/Timeline';

type Props = {
  selectedKey: string;
  setSelectedKey: (key: string) => void;
  onOpenMenu: () => void;
  onNewTask: (startMin?: number) => void;
  onEditTask: (id: string) => void;
};

function useNowMinute(): number {
  const [m, setM] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setM(d.getHours() * 60 + d.getMinutes());
    };
    const t = setInterval(tick, 30000);
    return () => clearInterval(t);
  }, []);
  return m;
}

export function TodayScreen({ selectedKey, setSelectedKey, onOpenMenu, onNewTask, onEditTask }: Props) {
  const insets = useSafeAreaInsets();
  const { tasks, settings, tasksForDay, toggleDone, moveTask } = useApp();
  const nowMin = useNowMinute();

  const dayTasks = tasksForDay(selectedKey);
  const { dayNum, weekday, month } = headerParts(selectedKey);
  const isToday = selectedKey === todayKey();

  const daysWithTasks = useMemo(() => new Set(tasks.map((t) => t.date)), [tasks]);

  // Drag state (transient; commits to the store on release).
  const [drag, setDrag] = useState<{ id: string; min: number } | null>(null);
  const dragMinRef = useRef(0);

  const onDragStart = (id: string) => {
    const t = dayTasks.find((x) => x.id === id);
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
      if (d && d.id === id && min !== (dayTasks.find((x) => x.id === id)?.start ?? min)) {
        moveTask(id, min);
      }
      return null;
    });
  };

  // Gentle scroll to "now" when viewing today.
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
          <Pressable style={styles.menuBtn} onPress={onOpenMenu} hitSlop={8}>
            <Feather name="menu" size={17} color={C.textDim} />
          </Pressable>
        </View>

        <WeekStrip
          selectedKey={selectedKey}
          weekStart={settings.weekStart}
          daysWithTasks={daysWithTasks}
          onSelect={setSelectedKey}
          onPageWeek={(delta) => setSelectedKey(addDays(selectedKey, delta * 7))}
        />
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={{ paddingTop: 6, paddingBottom: insets.bottom + 120 }}
        showsVerticalScrollIndicator={false}>
        <Timeline
          tasks={dayTasks}
          dayStart={settings.dayStart}
          dayEnd={settings.dayEnd}
          nowMin={isToday ? nowMin : null}
          dragId={drag?.id ?? null}
          dragMin={drag?.min ?? 0}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
          onEdit={onEditTask}
          onToggle={toggleDone}
          onAddAt={onNewTask}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 22, paddingBottom: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  dateRow: { flexDirection: 'row', alignItems: 'baseline', gap: 9 },
  dayNum: { fontSize: 38, fontWeight: '700', letterSpacing: -1, color: C.text, lineHeight: 40 },
  weekday: { fontSize: 22, fontWeight: '600', color: '#e8e8ec', letterSpacing: -0.4 },
  month: { fontSize: 15, fontWeight: '500', color: '#7a7a82', marginLeft: 2 },
  menuBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { flex: 1 },
});
