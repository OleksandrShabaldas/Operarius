import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, LinearTransition, SharedValue } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, Line, LinearGradient as SvgGradient, Stop } from 'react-native-svg';
import { Feather } from '@expo/vector-icons';
import { Clock, Task, Tag, Place } from '../types';
import { C, LANE_L, LANE_R, PILL_GAP, PILL_L, PILL_W, RAIL_X, TOPBAND } from '../theme';
import { ms } from '../motion';
import { fmt, fmtDur, hexA } from '../utils';
import { DayLayout, OverlapBand, Pos } from '../layout';
import { Hatch } from './Hatch';
import { Stripes } from './Stripes';
import { TaskCard, DayState } from './TaskCard';

export type DraggedCard = {
  task: Task; // shown collapsed while held
  h: number;
  baseY: number; // where the held card's original time sits on the drag ruler
  liveStart: number; // the time it would land on
  slot: Pos; // its landing slot in the (preview) layout the day is drawn with
};

type Props = {
  layout: DayLayout;
  dragged: DraggedCard | null;
  scrollY: SharedValue<number>;
  tags: Tag[];
  places: Place[];
  clock: Clock;
  dayStart: number;
  dayEnd: number;
  viewportH: number; // ScrollView height, so the end-of-day band can reach the screen bottom
  nowMin: number | null; // null when the viewed day is not today
  dayState: DayState;
  onDragStart: (id: string) => void;
  onDragMove: (id: string, dy: number, absY: number) => void;
  onDragEnd: (id: string) => void;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
  onToggleSubtask: (id: string, subId: string) => void;
  onToggleExpanded: (id: string) => void;
  onAddAt: (startMin: number) => void;
};

// Everything positioned from the layout glides with the cards (same timing as
// TaskCard's settle) when the day re-lays out — lifting, dropping, toggling.
// (Built per render so they follow the animation-speed setting.)
const glide = () => LinearTransition.duration(ms(240)).easing(Easing.out(Easing.cubic));
const appear = () => FadeIn.duration(ms(220));
const vanish = () => FadeOut.duration(ms(140));
const APressable = Animated.createAnimatedComponent(Pressable);

function HourTicks({ dayStart, dayEnd, yAt }: { dayStart: number; dayEnd: number; yAt: (m: number) => number }) {
  const first = Math.ceil(dayStart / 60);
  const last = Math.floor(dayEnd / 60);
  const rows = [];
  // Where the day is squeezed (a tall card right before the day's end, compressed
  // free time) two hours can land almost on top of each other — keep the first.
  let lastY = -Infinity;
  for (let h = first; h <= last; h++) {
    const y = yAt(h * 60);
    if (y - lastY < 16) continue;
    lastY = y;
    rows.push(
      <Animated.View key={h} layout={glide()} entering={appear()} exiting={vanish()} style={[styles.tickRow, { top: y }]}>
        <Text style={styles.tickLabel}>{String(h).padStart(2, '0')}</Text>
        <View style={styles.tickLine} />
      </Animated.View>
    );
  }
  // Half hours: a short dash under the hour numbers and a hairline across,
  // fainter still — left out where the day is squeezed (compressed free time).
  for (let h = Math.floor(dayStart / 60); h <= last; h++) {
    const m = h * 60 + 30;
    if (m <= dayStart || m >= dayEnd) continue;
    const y = yAt(m);
    const room = Math.min(y - yAt(Math.max(dayStart, m - 30)), yAt(Math.min(dayEnd, m + 30)) - y);
    if (room < 13) continue;
    rows.push(
      <Animated.View key={`half${h}`} layout={glide()} entering={appear()} exiting={vanish()} style={[styles.tickRow, { top: y }]}>
        <View style={styles.halfTick} />
        <View style={styles.halfLine} />
      </Animated.View>
    );
  }
  return <>{rows}</>;
}

// The timeline rail: dotted connectors running between the task pills,
// shading from one task's colour into the next (neutral before the first and
// after the last); red where it passes an overlap band.
type RailSeg = { key: string; top: number; bottom: number; from: string | null; to: string | null; warn: boolean };
const RAIL_PAD = 5; // breathing room between a connector and the pills it joins

function railSegments(layout: DayLayout): RailSeg[] {
  const { sorted, pos, overlaps, botTop } = layout;
  const items = sorted.filter((t) => pos[t.id]).sort((a, b) => pos[a.id].top - pos[b.id].top);
  const segs: RailSeg[] = [];
  let y = TOPBAND;
  let prev: Task | null = null;
  const push = (bottom: number, to: string | null) => {
    if (bottom - y < 2 * RAIL_PAD + 3) return;
    segs.push({
      key: prev ? `rail-${prev.id}` : 'rail-lead',
      top: y,
      bottom,
      from: prev?.color ?? null,
      to,
      warn: overlaps.some((o) => Math.abs(o.top - y) < 2),
    });
  };
  for (const t of items) {
    const p = pos[t.id];
    push(p.top, t.color);
    if (p.top + p.h > y) {
      y = p.top + p.h;
      prev = t;
    }
  }
  push(botTop, null);
  return segs;
}

let railSeq = 0;
const RailSegment = React.memo(
  function RailSegment({ seg }: { seg: RailSeg }) {
    const id = useMemo(() => `rail${railSeq++}`, []);
    const h = Math.max(1, Math.round(seg.bottom - seg.top - 2 * RAIL_PAD));
    const stop = (c: string | null) => (seg.warn ? { color: C.now, a: 0.85 } : c ? { color: c, a: 0.62 } : { color: '#ffffff', a: 0.16 });
    const a = stop(seg.from);
    const b = stop(seg.to);
    return (
      <Animated.View layout={glide()} entering={appear()} exiting={vanish()} pointerEvents="none" style={[styles.railSeg, { top: seg.top + RAIL_PAD, height: h }]}>
        <Svg width={6} height={h}>
          <Defs>
            <SvgGradient id={id} x1="0" y1="0" x2="0" y2={h} gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor={a.color} stopOpacity={a.a} />
              <Stop offset="1" stopColor={b.color} stopOpacity={b.a} />
            </SvgGradient>
          </Defs>
          <Line
            x1={3}
            y1={1.3}
            x2={3}
            y2={Math.max(1.3, h - 1.3)}
            stroke={`url(#${id})`}
            strokeWidth={seg.warn ? 2.6 : 2.3}
            strokeLinecap="round"
            strokeDasharray={seg.warn ? '0.01 4.6' : '0.01 6.4'}
          />
        </Svg>
      </Animated.View>
    );
  },
  (p, n) => p.seg.top === n.seg.top && p.seg.bottom === n.seg.bottom && p.seg.from === n.seg.from && p.seg.to === n.seg.to && p.seg.warn === n.seg.warn
);

function Rail({ layout }: { layout: DayLayout }) {
  return (
    <>
      {railSegments(layout).map((g) => (
        <RailSegment key={g.key} seg={g} />
      ))}
    </>
  );
}

// The bridge that fuses two overlapping cards into one stack: an opaque card
// surface tinted from the upper card's colour to the lower's, matching side
// rails, faded red stripes, and a centred "Overlapping · n min" label. It
// overlaps each card by 2px so the seam between them disappears.
function OverlapBridge({ band, grey }: { band: OverlapBand; grey: boolean }) {
  return (
    <Animated.View layout={glide()} entering={appear()} exiting={vanish()} pointerEvents="none" style={[styles.bridge, { top: band.top - 2, height: band.height + 4 }]}>
      <LinearGradient colors={[hexA(band.colorA, 0.09), hexA(band.colorB, 0.09)]} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={[hexA(band.colorA, 0.16), hexA(band.colorB, 0.16)]} style={[styles.rail, { left: 0 }]} />
      <LinearGradient colors={[hexA(band.colorA, 0.16), hexA(band.colorB, 0.16)]} style={[styles.rail, { right: 0 }]} />
      <Stripes color={C.now} opacity={0.55} spacing={6} strokeWidth={1} fade={{ top: 9, bottom: 9, left: 26, right: 26 }} style={StyleSheet.absoluteFill} />
      <View style={styles.ovPill}>
        <Feather name="alert-triangle" size={10} color={C.now} />
        <Text style={styles.ovTxt}>Overlapping · {fmtDur(band.minutes)}</Text>
      </View>
      {grey && (
        <>
          <View style={[StyleSheet.absoluteFill, styles.desat]} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(11,11,13,0.36)' }]} />
        </>
      )}
    </Animated.View>
  );
}

// Current time at the left end of the now line; AM/PM set smaller so the
// label stays within the hour column, clear of the pills.
function NowLabel({ min, clock }: { min: number; clock: Clock }) {
  const [time, ap] = fmt(min, clock).split(' ');
  return (
    <View style={styles.nowLabelBox}>
      <Text style={styles.nowLabel}>
        {time}
        {!!ap && <Text style={styles.nowAp}> {ap}</Text>}
      </Text>
    </View>
  );
}

export function Timeline(props: Props) {
  const { layout, dragged, tags, places, clock, dayStart, dayEnd, viewportH, nowMin, dayState } = props;
  const { sorted, pos, freeblocks, chips, overlaps, botTop, H, yAt } = layout;

  const showNow = nowMin != null && nowMin >= dayStart && nowMin <= dayEnd;
  const empty = sorted.length === 0;
  // Content fills at least the viewport so the end-of-day hatch reaches the
  // bottom of the screen with no black gap and no over-scroll.
  const contentH = Math.max(H + 100, viewportH);
  const endHeight = contentH - botTop;

  // While dragging, the layout is the landing preview (it already contains the
  // held card's slot). The held card itself stays in the same keyed list,
  // appended last, so it is the same component instance throughout — no
  // remount, no jump — and floats above everything.
  const cards = dragged ? [...sorted.filter((t) => t.id !== dragged.task.id), dragged.task] : sorted;
  const slot = dragged?.slot;
  const r = (joined?: boolean) => (joined ? 0 : 16);
  // Landing inside another task: the held card leaves the finger and sits in
  // its slot beneath that task, so the overlap is visible while dragging.
  const snapped = !!slot?.joinTop;
  const dragJoin = slot ? { top: !!slot.joinTop, bottom: !!slot.joinBottom } : undefined;
  const dragOverlap = !!slot && !!(slot.joinTop || slot.joinBottom);

  return (
    <View style={{ height: contentH }}>
      {/* Beginning-of-day band */}
      <Hatch color="#ff5a64" opacity={0.16} radius={13} style={[styles.band, { top: 0, height: TOPBAND - 2 }]}>
        <Text style={styles.bandTxt}>BEGINNING OF DAY · {fmt(dayStart, clock)}</Text>
      </Hatch>

      <HourTicks dayStart={dayStart} dayEnd={dayEnd} yAt={yAt} />
      <Rail layout={layout} />

      {/* Empty-day prompt */}
      {empty && (
        <Pressable onPress={() => props.onAddAt(dayStart)} style={[styles.free, { top: TOPBAND + 8, height: Math.max(90, botTop - TOPBAND - 16) }]}>
          <Hatch color="#ffffff" opacity={0.05} radius={16} style={StyleSheet.absoluteFill} />
          <Text style={styles.emptyTitle}>Nothing scheduled</Text>
          <Text style={styles.freeAdd}>＋ Create a task</Text>
        </Pressable>
      )}

      {/* Free blocks */}
      {freeblocks.map((g) => (
        <APressable
          key={g.key}
          layout={glide()}
          entering={appear()}
          exiting={vanish()}
          onPress={() => props.onAddAt(g.start)}
          style={[styles.free, { top: g.top, height: g.height }]}>
          <Hatch color="#ffffff" opacity={0.05} radius={14} style={StyleSheet.absoluteFill} />
          <Text style={styles.freeLabel}>{g.label}</Text>
          <Text style={styles.freeAdd}>＋ Create a task</Text>
        </APressable>
      ))}

      {/* Gap pills */}
      {chips.map((c) => (
        <Animated.View key={c.key} layout={glide()} entering={appear()} exiting={vanish()} style={[styles.chipRow, { top: c.top }]}>
          <View style={styles.chip}>
            <Text style={styles.chipTxt}>{c.label}</Text>
          </View>
        </Animated.View>
      ))}

      {/* Landing slot while dragging: the room the day has made for the held
          card — its pill's place on the rail and the card's outline (fused
          edges when it will overlap) — gliding as the time changes. Hidden
          while the card itself sits in the slot (fused beneath a task). */}
      {dragged && slot && !snapped && (
        <Animated.View
          pointerEvents="none"
          layout={LinearTransition.duration(ms(160)).easing(Easing.out(Easing.cubic))}
          entering={FadeIn.duration(ms(160))}
          exiting={FadeOut.duration(ms(140))}
          style={[styles.ghostWrap, { top: slot.top, height: slot.h }]}>
          <View style={[styles.ghostPill, { borderColor: hexA(dragged.task.color, 0.7), backgroundColor: hexA(dragged.task.color, 0.1) }]}>
            <Text style={styles.ghostEmoji}>{dragged.task.emoji}</Text>
          </View>
          <View
            style={[
              styles.ghost,
              {
                borderColor: hexA(dragged.task.color, 0.7),
                backgroundColor: hexA(dragged.task.color, 0.08),
                borderTopLeftRadius: r(slot.joinTop),
                borderTopRightRadius: r(slot.joinTop),
                borderBottomLeftRadius: r(slot.joinBottom),
                borderBottomRightRadius: r(slot.joinBottom),
              },
            ]}>
            <Text style={[styles.ghostTxt, { color: hexA(dragged.task.color, 0.95) }]}>
              {fmt(dragged.liveStart, clock)} – {fmt(dragged.liveStart + dragged.task.dur, clock)}
            </Text>
          </View>
        </Animated.View>
      )}

      {/* Task cards */}
      {cards.map((t, i) => {
        const isDrag = !!dragged && dragged.task.id === t.id;
        return (
          <TaskCard
            key={t.id}
            task={t}
            index={i}
            tags={tags}
            places={places}
            clock={clock}
            pos={isDrag ? { top: dragged!.baseY, h: dragged!.h } : pos[t.id]}
            isDragging={isDrag}
            dragBaseY={isDrag ? dragged!.baseY : undefined}
            dragSnapTop={isDrag && snapped ? slot!.top : null}
            dragJoin={isDrag ? dragJoin : undefined}
            dragOverlap={isDrag && dragOverlap}
            scrollY={props.scrollY}
            liveStart={isDrag ? dragged!.liveStart : t.start}
            nowMin={nowMin}
            dayState={dayState}
            onDragStart={props.onDragStart}
            onDragMove={props.onDragMove}
            onDragEnd={props.onDragEnd}
            onOpen={props.onOpen}
            onToggle={props.onToggle}
            onToggleSubtask={props.onToggleSubtask}
            onToggleExpanded={props.onToggleExpanded}
          />
        );
      })}

      {/* Overlap bridges (above the cards they fuse) */}
      {overlaps.map((o) => (
        <OverlapBridge key={o.key} band={o} grey={dayState === 'past' || (nowMin != null && o.endMin <= nowMin)} />
      ))}

      {/* End-of-day band */}
      <Animated.View layout={glide()} style={[styles.endBand, { top: botTop, height: endHeight }]}>
        <Hatch color="#ff5a64" opacity={0.16} radius={13} style={styles.endHatch}>
          <Text style={styles.endTxt}>END OF DAY · {fmt(dayEnd, clock)}</Text>
        </Hatch>
      </Animated.View>

      {/* Now line */}
      {showNow && (
        <Animated.View layout={glide()} style={[styles.nowLine, { top: yAt(nowMin!) }]}>
          <NowLabel min={nowMin!} clock={clock} />
          <View style={styles.nowDot} />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  band: { position: 'absolute', left: PILL_L, right: LANE_R, alignItems: 'center', justifyContent: 'center' },
  bandTxt: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.5, color: C.band },
  endBand: { position: 'absolute', left: PILL_L, right: LANE_R },
  endHatch: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 14 },
  endTxt: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.5, color: C.band },
  tickRow: { position: 'absolute', left: 0, right: 0, height: 0, pointerEvents: 'none' },
  tickLabel: { position: 'absolute', left: 10, top: -8, fontSize: 12, fontWeight: '600', color: C.tick, fontVariant: ['tabular-nums'] },
  tickLine: { position: 'absolute', left: LANE_L, right: LANE_R, top: 0, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.045)' },
  halfTick: { position: 'absolute', left: 14, top: -0.5, width: 7, height: 1, borderRadius: 0.5, backgroundColor: 'rgba(255,255,255,0.17)' },
  halfLine: { position: 'absolute', left: LANE_L, right: LANE_R, top: 0, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.022)' },
  railSeg: { position: 'absolute', left: RAIL_X - 3, width: 6, zIndex: 1 },
  free: { position: 'absolute', left: LANE_L, right: LANE_R, borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 3, zIndex: 1 },
  emptyTitle: { fontSize: 13, fontWeight: '600', color: C.muted },
  freeLabel: { fontSize: 12, fontWeight: '500', color: C.faint },
  freeAdd: { fontSize: 12, fontWeight: '600', color: C.muted },
  chipRow: { position: 'absolute', left: LANE_L, right: LANE_R, alignItems: 'center', zIndex: 4, pointerEvents: 'none' },
  chip: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 7, backgroundColor: 'rgba(30,31,35,0.95)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.09)' },
  chipTxt: { fontSize: 10.5, fontWeight: '600', color: C.muted },
  ghostWrap: { position: 'absolute', left: PILL_L, right: LANE_R, flexDirection: 'row', gap: PILL_GAP, zIndex: 3 },
  ghostPill: { width: PILL_W, borderRadius: PILL_W / 2, borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center', paddingTop: 17 },
  ghostEmoji: { fontSize: 17, lineHeight: 24, opacity: 0.4 },
  ghost: { flex: 1, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'flex-end', justifyContent: 'flex-start', paddingTop: 6, paddingRight: 10 },
  ghostTxt: { fontSize: 11, fontWeight: '800', fontVariant: ['tabular-nums'] },
  bridge: { position: 'absolute', left: LANE_L, right: LANE_R, backgroundColor: C.card, zIndex: 5, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  rail: { position: 'absolute', top: 0, bottom: 0, width: 1 },
  ovPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 8, backgroundColor: 'rgba(24,14,16,0.94)', boxShadow: 'inset 0 0 0 1px rgba(255,90,95,0.4)' },
  ovTxt: { fontSize: 10.5, fontWeight: '800', color: C.now, letterSpacing: 0.3, fontVariant: ['tabular-nums'] },
  desat: { backgroundColor: '#808080', mixBlendMode: 'saturation' },
  nowLine: { position: 'absolute', left: 0, right: LANE_R, height: 0, borderTopWidth: 1.5, borderTopColor: C.now, zIndex: 30, pointerEvents: 'none' },
  nowLabelBox: { position: 'absolute', left: 0, top: -8, height: 15, justifyContent: 'center', paddingHorizontal: 3, borderRadius: 5, backgroundColor: C.bg },
  nowLabel: { fontSize: 10, fontWeight: '700', color: C.now, fontVariant: ['tabular-nums'] },
  nowAp: { fontSize: 7.5, fontWeight: '800', letterSpacing: 0.2 },
  // On the rail; the dark ring keeps it legible over a pill.
  nowDot: { position: 'absolute', left: RAIL_X - 4.5, top: -5.25, width: 9, height: 9, borderRadius: 5, backgroundColor: C.now, boxShadow: `0 0 0 2px ${C.bg}, 0 0 10px ${C.now}` },
});
