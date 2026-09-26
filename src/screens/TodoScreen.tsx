import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { C } from '../theme';
import { Task } from '../types';
import { useApp } from '../store';
import { findTag, hexA, tagLabel } from '../utils';
import { NameSwap } from '../components/TaskCard';
import { Clock, Tag } from '../types';
import { customLabel, INTENSITY_COLOR, nextCustom } from '../reminders';
import { Appear, stagger, Tappable } from '../components/anim';
import { CheckBlock, TaskCheck } from '../components/TaskCheck';
import { StarMark } from '../components/StarToggle';

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
  // Starred (high priority) first.
  const open = todos.filter((t) => !t.done).sort((a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0));
  const done = todos.filter((t) => t.done);

  return (
    <View style={styles.root} collapsable={false}>
      <View style={[styles.head, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.title}>To-do</Text>
        <View style={styles.headBtns}>
          <Tappable style={styles.headBtn} onPress={onOpenStats} hitSlop={6}>
            <Feather name="bar-chart-2" size={18} color={C.textDim} />
          </Tappable>
          <Tappable style={styles.headBtn} onPress={onOpenSettings} hitSlop={6}>
            <Feather name="menu" size={18} color={C.textDim} />
          </Tappable>
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
        {open.map((t, i) => (
          <Animated.View key={t.id} entering={stagger(i)}>
            <TodoRow task={t} tag={findTag(settings.tags, t.tagId)} clock={settings.clock} onToggle={() => toggleDone(t.id)} onOpen={() => onOpenInfo(t.id)} />
          </Animated.View>
        ))}
        {done.length > 0 && <Text style={styles.section}>COMPLETED · {done.length}</Text>}
        {done.map((t, i) => (
          <Animated.View key={t.id} entering={stagger(open.length + i)}>
            <TodoRow task={t} tag={findTag(settings.tags, t.tagId)} clock={settings.clock} onToggle={() => toggleDone(t.id)} onOpen={() => onOpenInfo(t.id)} />
          </Animated.View>
        ))}
      </ScrollView>
    </View>
  );
}

function TodoRow({ task, tag, clock, onToggle, onOpen }: { task: Task; tag: Tag | null; clock: Clock; onToggle: () => void; onOpen: () => void }) {
  const { toggleAlt } = useApp();
  const tagColor = tag?.color || task.color;
  const next = task.done ? null : nextCustom(task.reminders);
  const remColor = task.reminders ? INTENSITY_COLOR[task.reminders.intensity] : C.muted;
  const subCount = task.subtasks.length;
  const subDone = task.subtasks.filter((s) => s.done).length;
  // The box follows the subtasks; when it refuses, the count says why for a
  // moment (what's still open, or to untick one to reopen the task).
  const [nudge, setNudge] = useState<{ n: number; why: CheckBlock }>({ n: 0, why: 'open' });
  const [hint, setHint] = useState(false);
  useEffect(() => {
    if (!nudge.n) return;
    setHint(true);
    const h = setTimeout(() => setHint(false), 2400);
    return () => clearTimeout(h);
  }, [nudge.n]);
  const warn = hint && nudge.why === 'open' && subDone < subCount;
  const locked = hint && nudge.why === 'locked' && subDone === subCount;
  return (
    <Tappable style={styles.row} onPress={onOpen}>
      <TaskCheck color={task.color} done={task.done} subTotal={subCount} subLeft={subCount - subDone} onToggle={onToggle} onBlocked={(why) => setNudge((x) => ({ n: x.n + 1, why }))} />
      <LinearGradient colors={[task.color, hexA(task.color, 0.72)]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={styles.icon}>
        <Text style={styles.iconTxt}>{task.emoji}</Text>
      </LinearGradient>
      <View style={{ flex: 1 }}>
        <NameSwap task={task} textStyle={[styles.rowTitle, task.done && styles.strike]} starSize={13} onSwap={() => toggleAlt(task.id)} />
        <View style={styles.metaRow}>
          {!!tag && (
            <View style={[styles.chip, { backgroundColor: hexA(tagColor, 0.15) }]}>
              <Text style={[styles.chipTxt, { color: tagColor }]}>{tagLabel(tag)}</Text>
            </View>
          )}
          {subCount > 0 &&
            (warn ? (
              <Appear key={nudge.n} from="left" distance={8} style={styles.subWarn}>
                <Feather name="lock" size={10} color={C.now} />
                <Text style={[styles.subCount, { color: C.now }]}>
                  {subCount - subDone === 1 ? '1 subtask left' : `${subCount - subDone} subtasks left`}
                </Text>
              </Appear>
            ) : locked ? (
              <Appear key={nudge.n} from="left" distance={8} style={styles.subWarn}>
                <Feather name="rotate-ccw" size={10} color={C.accentB} />
                <Text style={[styles.subCount, { color: C.accentB }]}>Untick a subtask to reopen</Text>
              </Appear>
            ) : (
              <View style={styles.subWarn}>
                <Feather name="check-square" size={10.5} color={C.muted} />
                <Text style={styles.subCount}>
                  {subDone}/{subCount}
                </Text>
              </View>
            ))}
          {next && (
            <View style={[styles.chip, styles.remChip, { backgroundColor: hexA(remColor, 0.12) }]}>
              <Feather name="bell" size={10} color={remColor} />
              <Text style={[styles.chipTxt, { color: remColor }]}>{customLabel(next, clock)}</Text>
            </View>
          )}
        </View>
      </View>
    </Tappable>
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
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  iconTxt: { fontSize: 18 },
  rowTitle: { flexShrink: 1, fontSize: 15.5, fontWeight: '600', color: C.text },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  star: { marginRight: 5 },
  strike: { textDecorationLine: 'line-through', color: '#6a6a72' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  chip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 7 },
  chipTxt: { fontSize: 10.5, fontWeight: '600' },
  subCount: { fontSize: 11.5, color: C.muted, fontWeight: '600', fontVariant: ['tabular-nums'] },
  subWarn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  remChip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
