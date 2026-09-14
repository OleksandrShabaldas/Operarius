import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Task } from '../types';
import { C, PX, TOPBAND, BOTBAND } from '../theme';
import { fmt } from '../utils';
import { computeDayLayout } from '../layout';
import { Hatch } from './Hatch';
import { TaskCard } from './TaskCard';

type Props = {
  tasks: Task[];
  dayStart: number;
  dayEnd: number;
  nowMin: number | null; // null when the viewed day is not today
  dragId: string | null;
  dragMin: number;
  onDragStart: (id: string) => void;
  onDragMove: (id: string, min: number) => void;
  onDragEnd: (id: string) => void;
  onEdit: (id: string) => void;
  onToggle: (id: string) => void;
  onAddAt: (startMin: number) => void;
};

// Dashed vertical spine — rendered as discrete dashes for reliable Android
// output. Memoized on height so it doesn't rebuild on every drag tick.
const Spine = React.memo(function Spine({ height }: { height: number }) {
  const n = Math.max(0, Math.floor(height / 9));
  return (
    <View style={[styles.spine, { height }]}>
      {Array.from({ length: n }, (_, i) => (
        <View key={i} style={styles.dash} />
      ))}
    </View>
  );
});

const HourTicks = React.memo(function HourTicks({
  dayStart,
  dayEnd,
}: {
  dayStart: number;
  dayEnd: number;
}) {
  const first = Math.ceil(dayStart / 60);
  const last = Math.floor(dayEnd / 60);
  const rows = [];
  for (let h = first; h <= last; h++) {
    const top = (h * 60 - dayStart) * PX + TOPBAND;
    rows.push(
      <View key={h} style={[styles.tickRow, { top }]}>
        <Text style={styles.tickLabel}>{String(h).padStart(2, '0')}</Text>
        <View style={styles.tickLine} />
      </View>
    );
  }
  return <>{rows}</>;
});

export function Timeline(props: Props) {
  const { tasks, dayStart, dayEnd, nowMin, dragId, dragMin } = props;
  const { sorted, pos, freeblocks, chips, botTop, H } = computeDayLayout(
    tasks,
    dayStart,
    dayEnd,
    dragId,
    dragMin
  );

  const showNow = nowMin != null && nowMin >= dayStart && nowMin <= dayEnd;
  const empty = tasks.length === 0;

  return (
    <View style={{ height: H }}>
      {/* Beginning-of-day band */}
      <Hatch
        color="#ff5a64"
        opacity={0.14}
        style={[styles.band, { top: 2, height: TOPBAND - 10 }]}>
        <Text style={styles.bandTxt}>BEGINNING OF DAY · {fmt(dayStart)}</Text>
      </Hatch>

      <HourTicks dayStart={dayStart} dayEnd={dayEnd} />
      <Spine height={botTop - TOPBAND + 2} />

      {/* Empty-day prompt */}
      {empty && (
        <Pressable
          onPress={() => props.onAddAt(dayStart)}
          style={[styles.empty, { top: TOPBAND + 8, height: Math.max(80, botTop - TOPBAND - 16) }]}>
          <Hatch color="#ffffff" opacity={0.05} radius={16} style={StyleSheet.absoluteFill} />
          <Text style={styles.emptyTitle}>Nothing scheduled</Text>
          <Text style={styles.emptyAdd}>＋ Create a task</Text>
        </Pressable>
      )}

      {/* Free blocks */}
      {freeblocks.map((g) => (
        <Pressable
          key={g.key}
          onPress={() => props.onAddAt(g.start)}
          style={[styles.free, { top: g.top, height: g.height }]}>
          <Hatch color="#ffffff" opacity={0.05} radius={14} style={StyleSheet.absoluteFill} />
          <Text style={styles.freeLabel}>{g.label}</Text>
          <Text style={styles.freeAdd}>＋ Create a task</Text>
        </Pressable>
      ))}

      {/* Gap chips */}
      {chips.map((c) => (
        <View key={c.key} style={[styles.chipRow, { top: c.top }]}>
          <View style={styles.chip}>
            <Text style={styles.chipTxt}>{c.label}</Text>
          </View>
        </View>
      ))}

      {/* Task cards */}
      {sorted.map((t) => (
        <TaskCard
          key={t.id}
          task={t}
          pos={pos[t.id]}
          isDragging={dragId === t.id}
          liveStart={dragId === t.id ? dragMin : t.start}
          nowMin={nowMin}
          dayStart={dayStart}
          dayEnd={dayEnd}
          onDragStart={props.onDragStart}
          onDragMove={props.onDragMove}
          onDragEnd={props.onDragEnd}
          onEdit={props.onEdit}
          onToggle={props.onToggle}
        />
      ))}

      {/* End-of-day band */}
      <Hatch
        color="#ff5a64"
        opacity={0.14}
        style={[styles.band, { top: botTop, height: BOTBAND - 8 }]}>
        <Text style={styles.bandTxt}>END OF DAY · {fmt(dayEnd)}</Text>
      </Hatch>

      {/* Now line */}
      {showNow && (
        <View style={[styles.nowLine, { top: (nowMin! - dayStart) * PX + TOPBAND }]}>
          <Text style={styles.nowLabel}>{fmt(nowMin!)}</Text>
          <View style={styles.nowDot} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    position: 'absolute',
    left: 56,
    right: 16,
    borderRadius: 13,
  },
  bandTxt: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.5, color: C.band },
  tickRow: { position: 'absolute', left: 0, right: 0, height: 0, pointerEvents: 'none' },
  tickLabel: {
    position: 'absolute',
    left: 10,
    top: -8,
    fontSize: 12,
    fontWeight: '600',
    color: C.tick,
    fontVariant: ['tabular-nums'],
  },
  tickLine: {
    position: 'absolute',
    left: 56,
    right: 16,
    top: 0,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.045)',
  },
  spine: {
    position: 'absolute',
    left: 41,
    top: TOPBAND - 2,
    width: 2,
    overflow: 'hidden',
    pointerEvents: 'none',
  },
  dash: { width: 2, height: 4, marginBottom: 5, backgroundColor: 'rgba(255,255,255,0.13)' },
  empty: {
    position: 'absolute',
    left: 56,
    right: 16,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  emptyTitle: { fontSize: 13, fontWeight: '600', color: C.muted },
  emptyAdd: { fontSize: 12.5, fontWeight: '600', color: C.text },
  free: {
    position: 'absolute',
    left: 56,
    right: 16,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  freeLabel: { fontSize: 12, fontWeight: '500', color: C.faint },
  freeAdd: { fontSize: 12, fontWeight: '600', color: C.muted },
  chipRow: {
    position: 'absolute',
    left: 56,
    right: 16,
    alignItems: 'center',
    zIndex: 3,
    pointerEvents: 'none',
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
    backgroundColor: 'rgba(30,31,35,0.95)',
    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.09)',
  },
  chipTxt: { fontSize: 10.5, fontWeight: '600', color: C.muted },
  nowLine: {
    position: 'absolute',
    left: 0,
    right: 16,
    height: 0,
    borderTopWidth: 1.5,
    borderTopColor: C.now,
    zIndex: 40,
    pointerEvents: 'none',
  },
  nowLabel: {
    position: 'absolute',
    left: 4,
    top: -8,
    fontSize: 10,
    fontWeight: '700',
    color: C.now,
    backgroundColor: C.bg,
    paddingHorizontal: 3,
    fontVariant: ['tabular-nums'],
  },
  nowDot: {
    position: 'absolute',
    left: 51,
    top: -4,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: C.now,
    boxShadow: `0 0 10px ${C.now}`,
  },
});
