import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { C } from '../theme';
import { Task } from '../types';
import { useApp } from '../store';
import { hexA, tagLabel } from '../utils';

export function TodoScreen({
  onOpenInfo,
  onOpenStats,
  onOpenSettings,
}: {
  onOpenInfo: (id: string) => void;
  onOpenStats: () => void;
  onOpenSettings: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { tasks, settings, toggleDone } = useApp();

  const todos = useMemo(() => tasks.filter((t) => t.type === 'todo'), [tasks]);
  const open = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);

  return (
    <View style={styles.root}>
      <View style={[styles.head, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.title}>To-do</Text>
        <View style={styles.headBtns}>
          <Pressable style={styles.headBtn} onPress={onOpenStats} hitSlop={6}>
            <Feather name="bar-chart-2" size={18} color={C.textDim} />
          </Pressable>
          <Pressable style={styles.headBtn} onPress={onOpenSettings} hitSlop={6}>
            <Feather name="menu" size={18} color={C.textDim} />
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 6, paddingBottom: insets.bottom + 130 }} showsVerticalScrollIndicator={false}>
        {todos.length === 0 && (
          <View style={styles.empty}>
            <Feather name="check-circle" size={34} color={C.faint} />
            <Text style={styles.emptyTitle}>No to-dos yet</Text>
            <Text style={styles.emptySub}>Tap ＋ and pick “To-do” to add one.</Text>
          </View>
        )}
        {open.map((t) => (
          <TodoRow key={t.id} task={t} tagName={tagLabel(settings.tags, t.tagId)} onToggle={() => toggleDone(t.id)} onOpen={() => onOpenInfo(t.id)} />
        ))}
        {done.length > 0 && <Text style={styles.section}>COMPLETED · {done.length}</Text>}
        {done.map((t) => (
          <TodoRow key={t.id} task={t} tagName={tagLabel(settings.tags, t.tagId)} onToggle={() => toggleDone(t.id)} onOpen={() => onOpenInfo(t.id)} />
        ))}
      </ScrollView>
    </View>
  );
}

function TodoRow({ task, tagName, onToggle, onOpen }: { task: Task; tagName: string; onToggle: () => void; onOpen: () => void }) {
  const subCount = task.subtasks.length;
  const subDone = task.subtasks.filter((s) => s.done).length;
  return (
    <Pressable style={styles.row} onPress={onOpen}>
      <Pressable onPress={onToggle} hitSlop={8} style={[styles.check, { boxShadow: `inset 0 0 0 2px ${task.done ? task.color : hexA(task.color, 0.5)}`, backgroundColor: task.done ? task.color : 'transparent' }]}>
        {task.done && <Feather name="check" size={14} color="#0b0b0d" />}
      </Pressable>
      <LinearGradient colors={[task.color, hexA(task.color, 0.72)]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={styles.icon}>
        <Text style={styles.iconTxt}>{task.emoji}</Text>
      </LinearGradient>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, task.done && styles.strike]} numberOfLines={1}>{task.title}</Text>
        <View style={styles.metaRow}>
          {!!tagName && (
            <View style={[styles.chip, { backgroundColor: hexA(task.color, 0.15) }]}>
              <Text style={[styles.chipTxt, { color: task.color }]}>{tagName}</Text>
            </View>
          )}
          {subCount > 0 && <Text style={styles.subCount}>☑ {subDone}/{subCount}</Text>}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingBottom: 10 },
  title: { fontSize: 30, fontWeight: '700', color: C.text, letterSpacing: -0.5 },
  headBtns: { flexDirection: 'row', gap: 10 },
  headBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', gap: 8, paddingTop: 80 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: C.textDim, marginTop: 4 },
  emptySub: { fontSize: 13.5, color: C.faint },
  section: { fontSize: 11, color: C.muted, fontWeight: '700', marginTop: 16, marginBottom: 10, letterSpacing: 0.3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 8, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.05)' },
  check: { width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  iconTxt: { fontSize: 18 },
  rowTitle: { fontSize: 15.5, fontWeight: '600', color: C.text },
  strike: { textDecorationLine: 'line-through', color: '#6a6a72' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  chip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 7 },
  chipTxt: { fontSize: 10.5, fontWeight: '600' },
  subCount: { fontSize: 11.5, color: C.muted, fontWeight: '600' },
});
