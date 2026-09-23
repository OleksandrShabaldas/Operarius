import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, LinearTransition, SharedValue } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { Clock, Task, Tag, Place } from '../types';
import { C, TOPBAND } from '../theme';
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
  for (let h = first; h <= last; h++) {
    rows.push(
      <Animated.View key={h} layout={glide()} style={[styles.tickRow, { top: yAt(h * 60) }]}>
        <Text style={styles.tickLabel}>{String(h).padStart(2, '0')}</Text>
        <View style={styles.tickLine} />
      </Animated.View>
    );
  }
  return <>{rows}</>;
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

  return (
    <View style={{ height: contentH }}>
      {/* Beginning-of-day band */}
      <Hatch color="#ff5a64" opacity={0.16} radius={13} style={[styles.band, { top: 0, height: TOPBAND - 2 }]}>
        <Text style={styles.bandTxt}>BEGINNING OF DAY · {fmt(dayStart, clock)}</Text>
      </Hatch>

      <HourTicks dayStart={dayStart} dayEnd={dayEnd} yAt={yAt} />
      <Spine height={botTop - TOPBAND + 2} />

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
          card (fused edges when it will overlap), gliding as the time changes. */}
      {dragged && slot && (
        <Animated.View
          pointerEvents="none"
          layout={LinearTransition.duration(ms(160)).easing(Easing.out(Easing.cubic))}
          entering={FadeIn.duration(ms(160))}
          exiting={FadeOut.duration(ms(140))}
          style={[
            styles.ghost,
            {
              top: slot.top,
              height: slot.h,
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
          <Text style={styles.nowLabel}>{fmt(nowMin!, clock)}</Text>
          <View style={styles.nowDot} />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  band: { position: 'absolute', left: 56, right: 16, alignItems: 'center', justifyContent: 'center' },
  bandTxt: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.5, color: C.band },
  endBand: { position: 'absolute', left: 56, right: 16 },
  endHatch: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 14 },
  endTxt: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.5, color: C.band },
  tickRow: { position: 'absolute', left: 0, right: 0, height: 0, pointerEvents: 'none' },
  tickLabel: { position: 'absolute', left: 10, top: -8, fontSize: 12, fontWeight: '600', color: C.tick, fontVariant: ['tabular-nums'] },
  tickLine: { position: 'absolute', left: 56, right: 16, top: 0, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.045)' },
  spine: { position: 'absolute', left: 41, top: TOPBAND - 2, width: 2, overflow: 'hidden', pointerEvents: 'none' },
  dash: { width: 2, height: 4, marginBottom: 5, backgroundColor: 'rgba(255,255,255,0.13)' },
  free: { position: 'absolute', left: 56, right: 16, borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 3, zIndex: 1 },
  emptyTitle: { fontSize: 13, fontWeight: '600', color: C.muted },
  freeLabel: { fontSize: 12, fontWeight: '500', color: C.faint },
  freeAdd: { fontSize: 12, fontWeight: '600', color: C.muted },
  chipRow: { position: 'absolute', left: 56, right: 16, alignItems: 'center', zIndex: 4, pointerEvents: 'none' },
  chip: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 7, backgroundColor: 'rgba(30,31,35,0.95)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.09)' },
  chipTxt: { fontSize: 10.5, fontWeight: '600', color: C.muted },
  ghost: { position: 'absolute', left: 56, right: 16, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', zIndex: 3, alignItems: 'flex-end', justifyContent: 'flex-start', paddingTop: 6, paddingRight: 10 },
  ghostTxt: { fontSize: 11, fontWeight: '800', fontVariant: ['tabular-nums'] },
  bridge: { position: 'absolute', left: 56, right: 16, backgroundColor: C.card, zIndex: 5, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  rail: { position: 'absolute', top: 0, bottom: 0, width: 1 },
  ovPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 8, backgroundColor: 'rgba(24,14,16,0.94)', boxShadow: 'inset 0 0 0 1px rgba(255,90,95,0.4)' },
  ovTxt: { fontSize: 10.5, fontWeight: '800', color: C.now, letterSpacing: 0.3, fontVariant: ['tabular-nums'] },
  desat: { backgroundColor: '#808080', mixBlendMode: 'saturation' },
  nowLine: { position: 'absolute', left: 0, right: 16, height: 0, borderTopWidth: 1.5, borderTopColor: C.now, zIndex: 30, pointerEvents: 'none' },
  nowLabel: { position: 'absolute', left: 4, top: -8, fontSize: 10, fontWeight: '700', color: C.now, backgroundColor: C.bg, paddingHorizontal: 3, fontVariant: ['tabular-nums'] },
  nowDot: { position: 'absolute', left: 51, top: -4, width: 9, height: 9, borderRadius: 5, backgroundColor: C.now, boxShadow: `0 0 10px ${C.now}` },
});
