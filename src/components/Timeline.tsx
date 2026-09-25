import React, { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeOut, SharedValue, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, Line, LinearGradient as SvgGradient, Stop } from 'react-native-svg';
import { Feather } from '@expo/vector-icons';
import { Clock, Task, Tag, Place } from '../types';
import { BAND_W, C, CARD_L, LANE_L, LANE_R, RAIL_X, TOPBAND } from '../theme';
import { ms } from '../motion';
import { fmt, fmtDur, hexA } from '../utils';
import { Chip, DayLayout, FreeBlock, OverlapBand, Pos } from '../layout';
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
  dayKey: string; // the day shown — its pieces are keyed to it
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
  onAddAt: (startMin: number, dur: number) => void;
};

// Minutes rounded to the nearest 5 (the time pickers' step).
const round5 = (m: number) => Math.round(m / 5) * 5;

// Everything positioned from the layout glides with the cards (TaskCard's
// settle timing) when the day re-lays out — lifting, dropping, adding, a new
// day — each piece on its own shared values (see useGlide). Pieces that come
// and go fade in on their own and fade out with `vanish`.
const vanish = () => FadeOut.duration(ms(140));
const APressable = Animated.createAnimatedComponent(Pressable);

// The hours down the side, from `dayStart` to `dayEnd` (the span shown), with
// the ones outside `win` (the day window — the red hours) tinted.
//
// Every row of the day (00–24, and the half hours) stays mounted, gliding to
// its place and fading in / out on its own. Rows coming and going as the span
// changed (the red hours of one day, not the next) left the layout-animation
// bookkeeping with stale positions for their neighbours after a day change —
// hours stuck where the last day had them.
function HourTicks({ dayStart, dayEnd, yAt, win }: { dayStart: number; dayEnd: number; yAt: (m: number) => number; win: [number, number] }) {
  // Hidden rows rest at the nearest edge of the span, so they fade in from there.
  const at = (m: number) => yAt(Math.min(dayEnd, Math.max(dayStart, m)));
  const rows = [];
  // Where the day is squeezed (a tall card right before the day's end, compressed
  // free time) two hours can land almost on top of each other — keep the first.
  let lastY = -Infinity;
  for (let h = 0; h <= 24; h++) {
    const m = h * 60;
    let on = m >= dayStart && m <= dayEnd;
    const y = at(m);
    if (on && y - lastY < 16) on = false;
    if (on) lastY = y;
    rows.push(<HourRow key={h} label={String(h).padStart(2, '0')} y={y} on={on} out={m < win[0] || m > win[1]} />);
  }
  // Half hours: a short dash under the hour numbers and a hairline across,
  // fainter still — left out where the day is squeezed (compressed free time).
  for (let h = 0; h < 24; h++) {
    const m = h * 60 + 30;
    const y = at(m);
    let on = m > dayStart && m < dayEnd;
    if (on) on = Math.min(y - at(m - 30), at(m + 30) - y) >= 13;
    rows.push(<HalfRow key={`half${h}`} y={y} on={on} />);
  }
  return <>{rows}</>;
}

// A value that glides to each new target with the rest of the day. Layout
// transitions used to do this, but on Android some of their updates were
// dropped now and then (a day change, a task added) and pieces stayed where
// the last layout had them — hours out of step, a free block under a card.
function useGlide(v: number, duration = 240) {
  const s = useSharedValue(v);
  useEffect(() => {
    s.value = withTiming(v, { duration: ms(duration), easing: Easing.out(Easing.cubic) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
  return s;
}

// A piece that appears with the layout fades in.
function useFadeIn(duration = 220) {
  const op = useSharedValue(0);
  useEffect(() => {
    op.value = withTiming(1, { duration: ms(duration) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return op;
}

// One row's glide and fade.
function useTickMotion(y: number, on: boolean) {
  const ty = useGlide(y);
  const op = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    op.value = withTiming(on ? 1 : 0, { duration: ms(on ? 220 : 140) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);
  return useAnimatedStyle(() => ({ opacity: op.value, transform: [{ translateY: ty.value }] }));
}

function HourRow({ label, y, on, out }: { label: string; y: number; on: boolean; out: boolean }) {
  const style = useTickMotion(y, on);
  return (
    <Animated.View style={[styles.tickRow, style]}>
      <Text style={[styles.tickLabel, out && styles.tickOut]}>{label}</Text>
      <View style={styles.tickLine} />
    </Animated.View>
  );
}

function HalfRow({ y, on }: { y: number; on: boolean }) {
  const style = useTickMotion(y, on);
  return (
    <Animated.View style={[styles.tickRow, style]}>
      <View style={styles.halfTick} />
      <View style={styles.halfLine} />
    </Animated.View>
  );
}

// The timeline rail: dotted connectors running between the tasks' colour
// bands, shading from one task's colour into the next (neutral before the
// first and after the last, and grey for tasks already behind you or done).
// Overlap bridges carry their own red connector.
type RailSeg = { key: string; top: number; bottom: number; from: string | null; to: string | null };
const RAIL_PAD = 5; // breathing room between a connector and the bands it joins

function railSegments(layout: DayLayout, isGrey: (t: Task) => boolean): RailSeg[] {
  const { sorted, pos, overlaps, botTop } = layout;
  const items = sorted.filter((t) => pos[t.id]).sort((a, b) => pos[a.id].top - pos[b.id].top);
  const segs: RailSeg[] = [];
  const tone = (t: Task) => (isGrey(t) ? GREY_RAIL : t.color);
  let y = TOPBAND;
  let prev: Task | null = null;
  const push = (bottom: number, to: string | null) => {
    if (bottom - y < 2 * RAIL_PAD + 3) return;
    if (overlaps.some((o) => Math.abs(o.top - y) < 2)) return;
    segs.push({ key: prev ? `rail-${prev.id}` : 'rail-lead', top: y, bottom, from: prev ? tone(prev) : null, to });
  };
  for (const t of items) {
    const p = pos[t.id];
    push(p.top, tone(t));
    if (p.top + p.h > y) {
      y = p.top + p.h;
      prev = t;
    }
  }
  push(botTop, null);
  return segs;
}
const GREY_RAIL = '#6a6a72';

let railSeq = 0;
const RailSegment = React.memo(
  function RailSegment({ seg }: { seg: RailSeg }) {
    const id = useMemo(() => `rail${railSeq++}`, []);
    const h = Math.max(1, Math.round(seg.bottom - seg.top - 2 * RAIL_PAD));
    const stop = (c: string | null) => (c ? { color: c, a: c === GREY_RAIL ? 0.5 : 0.62 } : { color: '#ffffff', a: 0.16 });
    const a = stop(seg.from);
    const b = stop(seg.to);
    const t = useGlide(seg.top + RAIL_PAD);
    const op = useFadeIn();
    const style = useAnimatedStyle(() => ({ opacity: op.value, transform: [{ translateY: t.value }] }));
    return (
      <Animated.View exiting={vanish()} pointerEvents="none" style={[styles.railSeg, { height: h }, style]}>
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
            strokeWidth={2.3}
            strokeLinecap="round"
            strokeDasharray="0.01 6.4"
          />
        </Svg>
      </Animated.View>
    );
  },
  (p, n) => p.seg.top === n.seg.top && p.seg.bottom === n.seg.bottom && p.seg.from === n.seg.from && p.seg.to === n.seg.to
);

function Rail({ layout, isGrey, dayKey }: { layout: DayLayout; isGrey: (t: Task) => boolean; dayKey: string }) {
  return (
    <>
      {railSegments(layout, isGrey).map((g) => (
        <RailSegment key={`${dayKey}:${g.key}`} seg={g} />
      ))}
    </>
  );
}

// The bridge that fuses two overlapping cards into one stack: an opaque card
// surface tinted from the upper card's colour to the lower's, their colour
// bands running on through it (dimmed, with a red dotted rail), faded red
// stripes, and a centred "Overlapping · n min" label — "Fully overlapping"
// when the lower task lies entirely inside the time above it, which is why
// the minutes stop growing at its own length. It overlaps each card by 2px so
// the seam between them disappears.
function OverlapBridge({ band, grey }: { band: OverlapBand; grey: boolean }) {
  const t = useGlide(band.top - 2);
  const op = useFadeIn();
  const style = useAnimatedStyle(() => ({ opacity: op.value, transform: [{ translateY: t.value }] }));
  return (
    <Animated.View exiting={vanish()} pointerEvents="none" style={[styles.bridge, { height: band.height + 4 }, style]}>
      {/* The stripes lie on the plain card surface (so their edges can fade into it), under the colour tint. */}
      <Stripes color={C.now} opacity={0.55} spacing={6} strokeWidth={1} fade={{ top: 9, bottom: 9, left: 26, right: 26 }} fadeTo={C.card} style={[StyleSheet.absoluteFill, { left: BAND_W }]} />
      <LinearGradient colors={[hexA(band.colorA, 0.09), hexA(band.colorB, 0.09)]} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={[hexA(band.colorA, 0.16), hexA(band.colorB, 0.16)]} style={[styles.rail, { right: 0 }]} />
      <View style={styles.bridgeBand}>
        <LinearGradient colors={[hexA(band.colorA, 0.42), hexA(band.colorB, 0.42)]} style={StyleSheet.absoluteFill} />
        <View style={styles.bridgeDots}>
          {Array.from({ length: Math.max(1, Math.floor((band.height - 6) / 7)) }, (_, i) => (
            <View key={i} style={styles.bridgeDot} />
          ))}
        </View>
      </View>
      <View style={styles.ovPill}>
        <Feather name="alert-triangle" size={10} color={C.now} />
        <Text style={styles.ovTxt}>
          {band.full ? 'Fully overlapping' : 'Overlapping'} · {fmtDur(band.minutes)}
        </Text>
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

// The beginning of the day: a band at the top, or — with tasks before the day
// starts — the red zone of those hours, labelled at the day's start.
// `lift`: how far the label rises to stay clear of a task across the day's start.
function BeginBand({ height, early, lift, label }: { height: number; early: boolean; lift: number; label: string }) {
  const h = useGlide(height);
  const l = useGlide(lift);
  const style = useAnimatedStyle(() => ({ height: h.value }));
  const txt = useAnimatedStyle(() => ({ transform: [{ translateY: -l.value }] }));
  return (
    <Animated.View pointerEvents="none" style={[styles.band, style]}>
      <Hatch color="#ff5a64" opacity={early ? 0.12 : 0.16} radius={13} style={[StyleSheet.absoluteFill, styles.bandInner, early && styles.bandAtEdge]}>
        <Animated.Text style={[styles.bandTxt, txt]}>{label}</Animated.Text>
      </Hatch>
    </Animated.View>
  );
}

// The end of the day: its red zone runs on to the bottom, under any later
// tasks. `drop`: how far the label moves down to clear a task across the end.
function EndBand({ top, height, drop, label }: { top: number; height: number; drop: number; label: string }) {
  const t = useGlide(top);
  const h = useGlide(height);
  const d = useGlide(drop);
  const style = useAnimatedStyle(() => ({ top: t.value, height: h.value }));
  const txt = useAnimatedStyle(() => ({ transform: [{ translateY: d.value }] }));
  return (
    <Animated.View pointerEvents="none" style={[styles.endBand, style]}>
      <Hatch color="#ff5a64" opacity={0.16} radius={13} style={styles.endHatch}>
        <Animated.Text style={[styles.endTxt, txt]}>{label}</Animated.Text>
      </Hatch>
    </Animated.View>
  );
}

function NowLine({ y, min, clock }: { y: number; min: number; clock: Clock }) {
  const t = useGlide(y);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: t.value }] }));
  return (
    <Animated.View style={[styles.nowLine, style]}>
      <NowLabel min={min} clock={clock} />
      <View style={styles.nowDot} />
    </Animated.View>
  );
}

// Free time: tap to fill it with a task.
function FreeBlockView({ g, label, live, onPress }: { g: FreeBlock; label: string; live: boolean; onPress: () => void }) {
  const t = useGlide(g.top);
  const h = useGlide(g.height);
  const op = useFadeIn();
  const style = useAnimatedStyle(() => ({ opacity: op.value, height: h.value, transform: [{ translateY: t.value }] }));
  return (
    <APressable exiting={vanish()} onPress={onPress} style={[styles.free, style]}>
      <Hatch color="#ffffff" opacity={0.05} radius={14} style={StyleSheet.absoluteFill} />
      <Text style={[styles.freeLabel, live && styles.freeLive]}>{label}</Text>
      <Text style={styles.freeAdd}>＋ Create a task</Text>
    </APressable>
  );
}

// A short gap between two tasks, as a pill.
function GapChip({ top, label, live }: { top: number; label: string; live: boolean }) {
  const t = useGlide(top);
  const op = useFadeIn();
  const style = useAnimatedStyle(() => ({ opacity: op.value, transform: [{ translateY: t.value }] }));
  return (
    <Animated.View exiting={vanish()} style={[styles.chipRow, style]}>
      <View style={styles.chip}>
        <Text style={[styles.chipTxt, live && styles.freeLive]}>{label}</Text>
      </View>
    </Animated.View>
  );
}

// Landing slot while dragging: the room the day has made for the held card —
// a dashed outline with its colour band on the rail (fused edges when it will
// overlap) — gliding as the time changes.
function DragSlot({ task, slot, liveStart, clock }: { task: Task; slot: Pos; liveStart: number; clock: Clock }) {
  const t = useGlide(slot.top, 160);
  const h = useGlide(slot.h, 160);
  const op = useFadeIn(160);
  const style = useAnimatedStyle(() => ({ opacity: op.value, height: h.value, transform: [{ translateY: t.value }] }));
  const r = (joined?: boolean) => (joined ? 0 : 16);
  return (
    <Animated.View
      pointerEvents="none"
      exiting={vanish()}
      style={[
        styles.ghost,
        {
          borderColor: hexA(task.color, 0.7),
          backgroundColor: hexA(task.color, 0.07),
          borderTopLeftRadius: r(slot.joinTop),
          borderTopRightRadius: r(slot.joinTop),
          borderBottomLeftRadius: r(slot.joinBottom),
          borderBottomRightRadius: r(slot.joinBottom),
        },
        style,
      ]}>
      <View style={[styles.ghostBand, { backgroundColor: hexA(task.color, 0.16) }]}>
        <Text style={styles.ghostEmoji}>{task.emoji}</Text>
      </View>
      <Text style={[styles.ghostTxt, { color: hexA(task.color, 0.95) }]}>
        {fmt(liveStart, clock)} – {fmt(liveStart + task.dur, clock)}
      </Text>
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
  const { layout, dayKey, dragged, tags, places, clock, dayStart, dayEnd, viewportH, nowMin, dayState } = props;
  const { sorted, pos, freeblocks, chips, overlaps, botTop, H, yAt, viewStart, viewEnd, startY, endY } = layout;

  const showNow = nowMin != null && nowMin >= viewStart && nowMin <= viewEnd;
  // Tasks before the day starts / after it ends: those hours are shown as red
  // zones (the day's own start / end stays marked at its edge).
  const early = startY > TOPBAND + 4;
  // A task running across the day's start or end would sit on that edge's
  // label — the label moves clear of it (above / below the task).
  const across = (y: number) => {
    let top = Infinity;
    let bottom = -Infinity;
    for (const t of sorted) {
      const p = pos[t.id];
      if (!p || p.top >= y - 1 || p.top + p.h <= y + 1) continue;
      top = Math.min(top, p.top);
      bottom = Math.max(bottom, p.top + p.h);
    }
    return { top, bottom };
  };
  const atStart = early ? across(startY) : null;
  const beginLift = atStart && atStart.top < Infinity ? startY - atStart.top : 0;
  const atEnd = across(endY);
  const endDrop = atEnd.bottom > -Infinity ? atEnd.bottom - endY : 0;
  const empty = sorted.length === 0;
  // Content fills at least the viewport so the end-of-day hatch reaches the
  // bottom of the screen with no black gap and no over-scroll.
  const contentH = Math.max(H + 100, viewportH);
  const endHeight = contentH - endY;

  // While dragging, the layout is the landing preview (it already contains the
  // held card's slot). The held card itself stays in the same keyed list,
  // appended last, so it is the same component instance throughout — no
  // remount, no jump — and floats above everything.
  const cards = dragged ? [...sorted.filter((t) => t.id !== dragged.task.id), dragged.task] : sorted;
  const slot = dragged?.slot;
  // Landing inside another task: the held card leaves the finger and sits in
  // its slot beneath that task, so the overlap is visible while dragging.
  const snapped = !!slot?.joinTop;
  const dragJoin = slot ? { top: !!slot.joinTop, bottom: !!slot.joinBottom } : undefined;
  const dragOverlap = !!slot && !!(slot.joinTop || slot.joinBottom);

  // Greyed on the rail like their cards: done, on a past day, or behind the now line.
  const isGrey = (t: Task) => t.done || dayState === 'past' || (nowMin != null && t.start + t.dur <= nowMin);
  // A gap the now line is inside counts down from now, and a task made from it
  // starts now. Otherwise it fills the gap — or, running to the end of the day,
  // starts there with the usual half hour.
  const live = (g: { start: number; end: number }) => nowMin != null && nowMin >= g.start && nowMin < g.end;
  const freeLabel = (g: FreeBlock) => (live(g) ? `${fmtDur(g.end - nowMin!)} left` : g.label);
  const chipLabel = (c: Chip) => (live(c) ? `${c.end - nowMin!} min left` : c.label);
  const addIn = (g: FreeBlock) => {
    const start = live(g) ? Math.min(Math.max(g.start, round5(nowMin!)), g.end - 5) : g.start;
    props.onAddAt(start, g.bounded ? Math.max(5, g.end - start) : 30);
  };
  const addEmpty = () => {
    const now = nowMin != null && nowMin >= dayStart && nowMin < dayEnd - 5 ? round5(nowMin) : null;
    props.onAddAt(now ?? dayStart, 30);
  };

  return (
    <View style={{ height: contentH }}>
      <BeginBand height={startY - 2} early={early} lift={beginLift} label={`BEGINNING OF DAY · ${fmt(dayStart, clock)}`} />
      <EndBand top={endY} height={endHeight} drop={endDrop} label={`END OF DAY · ${fmt(dayEnd, clock)}`} />

      <HourTicks dayStart={viewStart} dayEnd={viewEnd} yAt={yAt} win={[dayStart, dayEnd]} />
      <Rail layout={layout} isGrey={isGrey} dayKey={dayKey} />

      {/* Empty-day prompt */}
      {empty && (
        <Pressable onPress={addEmpty} style={[styles.free, { top: TOPBAND + 8, height: Math.max(90, botTop - TOPBAND - 16) }]}>
          <Hatch color="#ffffff" opacity={0.05} radius={16} style={StyleSheet.absoluteFill} />
          <Text style={styles.emptyTitle}>Nothing scheduled</Text>
          <Text style={styles.freeAdd}>＋ Create a task</Text>
        </Pressable>
      )}

      {/* Free blocks */}
      {freeblocks.map((g) => (
        <FreeBlockView key={`${dayKey}:${g.key}`} g={g} label={freeLabel(g)} live={live(g)} onPress={() => addIn(g)} />
      ))}

      {/* Gap pills */}
      {chips.map((c) => (
        <GapChip key={`${dayKey}:${c.key}`} top={c.top} label={chipLabel(c)} live={live(c)} />
      ))}

      {/* Landing slot while dragging — hidden while the card itself sits in
          the slot (fused beneath a task). */}
      {dragged && slot && !snapped && <DragSlot task={dragged.task} slot={slot} liveStart={dragged.liveStart} clock={clock} />}

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
        <OverlapBridge key={`${dayKey}:${o.key}`} band={o} grey={dayState === 'past' || (nowMin != null && o.endMin <= nowMin)} />
      ))}

      {/* Now line */}
      {showNow && <NowLine y={yAt(nowMin!)} min={nowMin!} clock={clock} />}
    </View>
  );
}

const styles = StyleSheet.create({
  band: { position: 'absolute', top: 0, left: CARD_L, right: LANE_R },
  bandInner: { alignItems: 'center', justifyContent: 'center' },
  bandAtEdge: { justifyContent: 'flex-end', paddingBottom: 10 },
  bandTxt: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.5, color: C.band },
  endBand: { position: 'absolute', left: CARD_L, right: LANE_R },
  endHatch: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 14 },
  endTxt: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.5, color: C.band },
  tickRow: { position: 'absolute', left: 0, right: 0, top: 0, height: 0, pointerEvents: 'none' },
  tickLabel: { position: 'absolute', left: 10, top: -8, fontSize: 12, fontWeight: '600', color: C.tick, fontVariant: ['tabular-nums'] },
  tickOut: { color: 'rgba(255,107,112,0.55)' },
  tickLine: { position: 'absolute', left: LANE_L, right: LANE_R, top: 0, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.045)' },
  halfTick: { position: 'absolute', left: 14, top: -0.5, width: 7, height: 1, borderRadius: 0.5, backgroundColor: 'rgba(255,255,255,0.17)' },
  halfLine: { position: 'absolute', left: LANE_L, right: LANE_R, top: 0, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.022)' },
  railSeg: { position: 'absolute', top: 0, left: RAIL_X - 3, width: 6, zIndex: 1 },
  free: { position: 'absolute', top: 0, left: LANE_L, right: LANE_R, borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 3, zIndex: 1 },
  emptyTitle: { fontSize: 13, fontWeight: '600', color: C.muted },
  freeLabel: { fontSize: 12, fontWeight: '500', color: C.faint },
  freeLive: { color: C.now, fontWeight: '700' },
  freeAdd: { fontSize: 12, fontWeight: '600', color: C.muted },
  chipRow: { position: 'absolute', top: 0, left: LANE_L, right: LANE_R, alignItems: 'center', zIndex: 4, pointerEvents: 'none' },
  chip: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 7, backgroundColor: 'rgba(30,31,35,0.95)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.09)' },
  chipTxt: { fontSize: 10.5, fontWeight: '600', color: C.muted },
  ghost: { position: 'absolute', top: 0, left: CARD_L, right: LANE_R, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', zIndex: 3, overflow: 'hidden', alignItems: 'flex-end', justifyContent: 'flex-start', paddingTop: 6, paddingRight: 10 },
  ghostBand: { position: 'absolute', left: 0, top: 0, bottom: 0, width: BAND_W - 1.5, alignItems: 'center', paddingTop: 15.5 },
  ghostEmoji: { fontSize: 17, lineHeight: 24, opacity: 0.45 },
  ghostTxt: { fontSize: 11, fontWeight: '800', fontVariant: ['tabular-nums'] },
  bridge: { position: 'absolute', top: 0, left: CARD_L, right: LANE_R, backgroundColor: C.card, zIndex: 5, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', paddingLeft: BAND_W },
  bridgeBand: { position: 'absolute', left: 0, top: 0, bottom: 0, width: BAND_W, alignItems: 'center', justifyContent: 'center' },
  bridgeDots: { alignItems: 'center', gap: 4.5 },
  bridgeDot: { width: 2.5, height: 2.5, borderRadius: 1.25, backgroundColor: C.now, opacity: 0.9 },
  rail: { position: 'absolute', top: 0, bottom: 0, width: 1 },
  ovPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 8, backgroundColor: 'rgba(24,14,16,0.94)', boxShadow: 'inset 0 0 0 1px rgba(255,90,95,0.4)' },
  ovTxt: { fontSize: 10.5, fontWeight: '800', color: C.now, letterSpacing: 0.3, fontVariant: ['tabular-nums'] },
  desat: { backgroundColor: '#808080', mixBlendMode: 'saturation' },
  nowLine: { position: 'absolute', top: 0, left: 0, right: LANE_R, height: 0, borderTopWidth: 1.5, borderTopColor: C.now, zIndex: 30, pointerEvents: 'none' },
  nowLabelBox: { position: 'absolute', left: 0, top: -8, height: 15, justifyContent: 'center', paddingHorizontal: 3, borderRadius: 5, backgroundColor: C.bg },
  nowLabel: { fontSize: 10, fontWeight: '700', color: C.now, fontVariant: ['tabular-nums'] },
  nowAp: { fontSize: 7.5, fontWeight: '800', letterSpacing: 0.2 },
  // On the rail; the dark ring keeps it legible over a pill.
  nowDot: { position: 'absolute', left: RAIL_X - 4.5, top: -5.25, width: 9, height: 9, borderRadius: 5, backgroundColor: C.now, boxShadow: `0 0 0 2px ${C.bg}, 0 0 10px ${C.now}` },
});
