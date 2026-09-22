import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Clock, Task, Tag, Place } from '../types';
import { C, TOPBAND } from '../theme';
import { fmt } from '../utils';
import { computeDayLayout } from '../layout';
import { Hatch } from './Hatch';
import { TaskCard, DayState } from './TaskCard';

type Props = {
  tasks: Task[];
  tags: Tag[];
  places: Place[];
  clock: Clock;
  dayStart: number;
  dayEnd: number;
  gapThreshold: number;
  viewportH: number; // ScrollView height, so the end-of-day band can reach the screen bottom
  nowMin: number | null; // null when the viewed day is not today
  dayState: DayState;
  allowOverlap: boolean; // tasks may overlap in time (off = dragging swaps instead)
  dragId: string | null;
  dragMin: number;
  onDragStart: (id: string) => void;
  onDragMove: (id: string, min: number) => void;
  onDragEnd: (id: string) => void;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
  onToggleSubtask: (id: string, subId: string) => void;
  onToggleExpanded: (id: string) => void;
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

function HourTicks({
  dayStart,
  dayEnd,
  yAt,
}: {
  dayStart: number;
  dayEnd: number;
  yAt: (m: number) => number;
}) {
  const first = Math.ceil(dayStart / 60);
  const last = Math.floor(dayEnd / 60);
  const rows = [];
  for (let h = first; h <= last; h++) {
    rows.push(
      <View key={h} style={[styles.tickRow, { top: yAt(h * 60) }]}>
        <Text style={styles.tickLabel}>{String(h).padStart(2, '0')}</Text>
        <View style={styles.tickLine} />
      </View>
    );
  }
  return <>{rows}</>;
}

export function Timeline(props: Props) {
  const { tasks, tags, places, clock, dayStart, dayEnd, gapThreshold, viewportH, nowMin, dayState, dragId, dragMin } = props;
  const { sorted, pos, freeblocks, chips, overlaps, botTop, H, yAt } = computeDayLayout(
    tasks,
    dayStart,
    dayEnd,
    gapThreshold,
    props.allowOverlap
  );

  const showNow = nowMin != null && nowMin >= dayStart && nowMin <= dayEnd;
  const empty = tasks.length === 0;
  // Content fills at least the viewport so the end-of-day hatch reaches the
  // bottom of the screen with no black gap and no over-scroll (#16).
  const contentH = Math.max(H + 100, viewportH);
  const endHeight = contentH - botTop;

  return (
    <View style={{ height: contentH }}>
      {/* Beginning-of-day band — full width, bleeds to the screen edges. */}
      <Hatch
        color="#ff5a64"
        opacity={0.16}
        radius={13}
        style={[styles.band, { top: 0, height: TOPBAND - 2 }]}>
        <Text style={styles.bandTxt}>BEGINNING OF DAY · {fmt(dayStart, clock)}</Text>
      </Hatch>

      <HourTicks dayStart={dayStart} dayEnd={dayEnd} yAt={yAt} />
      <Spine height={botTop - TOPBAND + 2} />

      {/* Empty-day prompt */}
      {empty && (
        <Pressable
          onPress={() => props.onAddAt(dayStart)}
          style={[styles.free, { top: TOPBAND + 8, height: Math.max(90, botTop - TOPBAND - 16) }]}>
          <Hatch color="#ffffff" opacity={0.05} radius={16} style={StyleSheet.absoluteFill} />
          <Text style={styles.emptyTitle}>Nothing scheduled</Text>
          <Text style={styles.freeAdd}>＋ Create a task</Text>
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

      {/* Gap pills */}
      {chips.map((c) => (
        <View key={c.key} style={[styles.chipRow, { top: c.top }]}>
          <View style={styles.chip}>
            <Text style={styles.chipTxt}>{c.label}</Text>
          </View>
        </View>
      ))}

      {/* Task cards */}
      {sorted.map((t, i) => (
        <TaskCard
          key={t.id}
          task={t}
          index={i}
          tags={tags}
          places={places}
          clock={clock}
          pos={pos[t.id]}
          isDragging={dragId === t.id}
          liveStart={dragId === t.id ? dragMin : t.start}
          nowMin={nowMin}
          dayState={dayState}
          dayStart={dayStart}
          dayEnd={dayEnd}
          onDragStart={props.onDragStart}
          onDragMove={props.onDragMove}
          onDragEnd={props.onDragEnd}
          onOpen={props.onOpen}
          onToggle={props.onToggle}
          onToggleSubtask={props.onToggleSubtask}
          onToggleExpanded={props.onToggleExpanded}
        />
      ))}

      {/* Overlap regions — diagonal blend + "Overlapping" label where cards intersect. */}
      {overlaps.map((o) => (
        <View key={o.key} pointerEvents="none" style={[styles.overlap, { top: o.top, height: o.height }]}>
          <Hatch color="#ffffff" opacity={0.32} radius={12} fade={C.card} fadeSize={18} style={StyleSheet.absoluteFill} />
          <Text style={styles.overlapTxt}>Overlapping</Text>
        </View>
      ))}

      {/* End-of-day band — full width, extends to the bottom of the screen. */}
      <Hatch
        color="#ff5a64"
        opacity={0.16}
        radius={13}
        style={[styles.endBand, { top: botTop, height: endHeight }]}>
        <Text style={styles.endTxt}>END OF DAY · {fmt(dayEnd, clock)}</Text>
      </Hatch>

      {/* Now line */}
      {showNow && (
        <View style={[styles.nowLine, { top: yAt(nowMin!) }]}>
          <Text style={styles.nowLabel}>{fmt(nowMin!, clock)}</Text>
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  bandTxt: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.5, color: C.band },
  endBand: {
    position: 'absolute',
    left: 56,
    right: 16,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 14,
  },
  endTxt: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.5, color: C.band },
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
  free: {
    position: 'absolute',
    left: 56,
    right: 16,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    zIndex: 1,
  },
  emptyTitle: { fontSize: 13, fontWeight: '600', color: C.muted },
  freeLabel: { fontSize: 12, fontWeight: '500', color: C.faint },
  freeAdd: { fontSize: 12, fontWeight: '600', color: C.muted },
  chipRow: {
    position: 'absolute',
    left: 56,
    right: 16,
    alignItems: 'center',
    zIndex: 4,
    pointerEvents: 'none',
  },
  chip: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 7,
    backgroundColor: 'rgba(30,31,35,0.95)',
    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.09)',
  },
  chipTxt: { fontSize: 10.5, fontWeight: '600', color: C.muted },
  overlap: { position: 'absolute', left: 56, right: 16, alignItems: 'center', justifyContent: 'center', zIndex: 6 },
  overlapTxt: { fontSize: 10.5, fontWeight: '800', color: C.now, letterSpacing: 0.5, backgroundColor: 'rgba(11,11,13,0.55)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, overflow: 'hidden' },
  nowLine: {
    position: 'absolute',
    left: 0,
    right: 16,
    height: 0,
    borderTopWidth: 1.5,
    borderTopColor: C.now,
    zIndex: 30,
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
