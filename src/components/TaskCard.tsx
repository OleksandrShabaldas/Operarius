import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  runOnUI,
  SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Clock, Place, Tag, Task } from '../types';
import { C } from '../theme';
import { fmt, fmtDur, findTag, hexA, placeLabel } from '../utils';
import { Pos } from '../layout';
import { PlaceIcon } from './PlaceIcon';
import { Stripes } from './Stripes';
import { stagger, Tappable } from './anim';

export type DayState = 'past' | 'today' | 'future';

const SUB_ROW_H = 25; // keep in sync with layout.ts SUB_ROW_H

type Props = {
  task: Task;
  index: number;
  tags: Tag[];
  places: Place[];
  clock: Clock;
  pos: Pos;
  isDragging: boolean;
  dragBaseY?: number; // while lifted: where this task's time sits in the timeline
  scrollY: SharedValue<number>; // the timeline's scroll offset (UI thread), for auto-scroll during a drag
  nowMin: number | null; // null when the viewed day is not today
  dayState: DayState;
  liveStart: number;
  onDragStart: (id: string) => void;
  onDragMove: (id: string, dy: number, absY: number) => void;
  onDragEnd: (id: string) => void;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
  onToggleSubtask: (id: string, subId: string) => void;
  onToggleExpanded: (id: string) => void;
};

// Visual content of a card (icon + text + meta).
function CardFace({ task, s, end, clock, tags, places }: { task: Task; s: number; end: number; clock: Clock; tags: Tag[]; places: Place[] }) {
  const color = task.color;
  const tag = findTag(tags, task.tagId);
  const tagColor = tag?.color || color;
  const placeTxt = placeLabel(places, task.placeId);
  return (
    <>
      <LinearGradient
        colors={[color, hexA(color, 0.72)]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={[styles.icon, { boxShadow: `0 5px 16px -3px ${hexA(color, 0.85)}, 0 0 0 1px ${hexA(color, 0.3)}` }]}>
        <Text style={styles.iconTxt}>{task.emoji}</Text>
      </LinearGradient>
      <View style={styles.body}>
        <Text numberOfLines={1} style={[styles.title, task.done && styles.strike]}>{task.title}</Text>
        <View style={styles.timeRow}>
          <Text numberOfLines={1} style={styles.time}>
            {fmt(s, clock)} – {fmt(end, clock)} <Text style={styles.dur}>· {fmtDur(task.dur)}</Text>
          </Text>
          {!!task.repeat && <Feather name="repeat" size={10.5} color={C.muted} style={styles.repeatIcon} />}
        </View>
        {(!!tag || !!placeTxt) && (
          <View style={styles.metaRow}>
            {!!tag && (
              <View style={[styles.chip, { backgroundColor: hexA(tagColor, 0.15), borderColor: hexA(tagColor, 0.28) }]}>
                <Text style={[styles.chipTxt, { color: tagColor }]}>{tag.name}</Text>
              </View>
            )}
            {!!placeTxt && (
              <View style={[styles.chip, styles.placeChip]}>
                <PlaceIcon size={10} color={C.muted} />
                <Text style={styles.placeTxt}>{placeTxt}</Text>
              </View>
            )}
          </View>
        )}
      </View>
    </>
  );
}

// Inline subtask strip at the bottom of a card: a "n/m subtasks" toggle that
// expands to show tappable subtask rows. Expanded state is persisted per task.
function SubtaskStrip({ task, onToggleExpanded, onToggleSubtask }: { task: Task; onToggleExpanded: () => void; onToggleSubtask: (subId: string) => void }) {
  const done = task.subtasks.filter((s) => s.done).length;
  const total = task.subtasks.length;
  return (
    <View style={styles.subStrip}>
      <Tappable onPress={onToggleExpanded} hitSlop={6} style={styles.subToggle}>
        <Feather name={task.expanded ? 'chevron-up' : 'chevron-down'} size={13} color={C.muted} />
        <Text style={styles.subToggleTxt}>
          {done}/{total} subtasks
        </Text>
      </Tappable>
      {task.expanded &&
        task.subtasks.map((sub) => (
          <Tappable key={sub.id} onPress={() => onToggleSubtask(sub.id)} hitSlop={4} style={styles.subItem}>
            <View style={[styles.subDot, sub.done && { backgroundColor: task.color, borderColor: task.color }]}>
              {sub.done && <Feather name="check" size={9} color="#0b0b0d" />}
            </View>
            <Text style={[styles.subItemTxt, sub.done && styles.subItemDone]} numberOfLines={1}>
              {sub.title || 'Untitled'}
            </Text>
          </Tappable>
        ))}
    </View>
  );
}

// "Missed" chip in the top-right corner, with a tight halo of faded red
// warning stripes centred on it (masked, so it dissolves into the card).
function MissedBadge() {
  return (
    <View pointerEvents="none" style={styles.missedWrap}>
      <Stripes color={C.now} opacity={0.75} spacing={4} strokeWidth={0.9} fade="radial" style={StyleSheet.absoluteFill} />
      <View style={styles.missedBadge}>
        <Text style={styles.missedTxt}>Missed</Text>
      </View>
    </View>
  );
}

function TaskCardBase(props: Props) {
  const { task, tags, places, clock, pos, isDragging, nowMin, liveStart, scrollY } = props;

  // Resting position is animated; while lifted, the card is positioned on the
  // UI thread from the finger (base + dy + auto-scroll) — no React in the loop.
  const topSV = useSharedValue(pos.top);
  const baseS = useSharedValue(pos.top);
  const dyS = useSharedValue(0);
  const scroll0 = useSharedValue(0);
  const dragging = useSharedValue(0);
  const scale = useSharedValue(1);
  const draggingRef = useRef(false);
  const [endTick, setEndTick] = useState(0);

  // Settle into the resting slot. After a drop, start from exactly where the
  // card is on screen (atomically on the UI thread) so it glides, never jumps.
  useEffect(() => {
    if (isDragging) return;
    const target = pos.top;
    runOnUI(() => {
      'worklet';
      if (dragging.value) {
        topSV.value = baseS.value + dyS.value + (scrollY.value - scroll0.value);
        dragging.value = 0;
      }
      topSV.value = withTiming(target, { duration: 240, easing: Easing.out(Easing.cubic) });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos.top, isDragging, endTick]);

  // Once lifted, glide the drag anchor to where this task's time sits in the
  // (now hole-free) timeline, so the finger→time mapping is exact.
  useEffect(() => {
    if (isDragging && props.dragBaseY != null) {
      baseS.value = withTiming(props.dragBaseY, { duration: 170, easing: Easing.out(Easing.cubic) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging, props.dragBaseY]);

  const beginDrag = () => {
    draggingRef.current = true;
    scale.value = withSpring(1.03, { damping: 18, stiffness: 260 });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    props.onDragStart(task.id);
  };
  const moveDrag = (dy: number, absY: number) => {
    if (draggingRef.current) props.onDragMove(task.id, dy, absY);
  };
  const endDrag = () => {
    scale.value = withSpring(1, { damping: 18, stiffness: 260 });
    if (draggingRef.current) {
      draggingRef.current = false;
      Haptics.selectionAsync().catch(() => {});
      props.onDragEnd(task.id);
    }
    setEndTick((n) => n + 1);
  };
  const open = () => props.onOpen(task.id);

  const pan = Gesture.Pan()
    .activateAfterLongPress(320)
    .onStart(() => {
      'worklet';
      baseS.value = topSV.value;
      dyS.value = 0;
      scroll0.value = scrollY.value;
      dragging.value = 1;
      runOnJS(beginDrag)();
    })
    .onUpdate((e) => {
      'worklet';
      dyS.value = e.translationY;
      runOnJS(moveDrag)(e.translationY, e.absoluteY);
    })
    .onFinalize(() => {
      'worklet';
      runOnJS(endDrag)();
    });
  const tap = Gesture.Tap().onEnd((_e, ok) => {
    'worklet';
    if (ok) runOnJS(open)();
  });
  const gesture = Gesture.Exclusive(pan, tap);

  const wrapStyle = useAnimatedStyle(() => ({
    top: dragging.value ? baseS.value + dyS.value + (scrollY.value - scroll0.value) : topSV.value,
  }));
  const cardAnim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const color = task.color;
  const s = liveStart;
  const end = s + task.dur;
  const hasMeta = !!task.tagId || !!task.placeId;

  // Visual state:
  //  • whole day in the past → fully grayscale (history), "Missed" if not done
  //  • done                  → fully grayscale (a touch darker once it's past)
  //  • in-progress           → the elapsed portion grayscales (progress)
  //  • past + not done       → "Missed" (elapsed grayscale, red corner badge)
  const isPastDay = props.dayState === 'past';
  const isFutureDay = props.dayState === 'future';
  const past = isPastDay || (nowMin != null && end <= nowMin);
  const inProgress = !isPastDay && !isFutureDay && nowMin != null && s < nowMin && nowMin < end;
  const missed = !task.done && past;
  const hasNote = !!task.notes.trim();
  let oh = 0;
  if (!isDragging) {
    if (task.done || isPastDay) oh = pos.h;
    else if (inProgress) oh = Math.round(((nowMin! - s) / task.dur) * pos.h);
  }
  const dimAlpha = task.done ? (past ? 0.46 : 0.2) : isPastDay ? 0.42 : 0.32;

  // Fused edges (overlap stacks) square off so the stack reads as one shape.
  const radii = {
    borderTopLeftRadius: pos.joinTop && !isDragging ? 0 : 16,
    borderTopRightRadius: pos.joinTop && !isDragging ? 0 : 16,
    borderBottomLeftRadius: pos.joinBottom && !isDragging ? 0 : 16,
    borderBottomRightRadius: pos.joinBottom && !isDragging ? 0 : 16,
  };

  const cardShadow = `inset 0 0 0 1px ${hexA(color, isDragging ? 0.45 : 0.16)}, 0 0 24px -6px ${hexA(color, isDragging ? 0.65 : 0.3)}${isDragging ? ', 0 22px 44px -12px rgba(0,0,0,.85)' : ''}`;

  return (
    <Animated.View style={[styles.wrap, wrapStyle, { zIndex: isDragging ? 50 : 2 }]} entering={stagger(props.index)}>
      <Animated.View style={[styles.card, radii, cardAnim, { minHeight: pos.h, boxShadow: cardShadow }]}>
        <View style={styles.cardMain}>
          <GestureDetector gesture={gesture}>
            <Animated.View style={styles.grab}>
              <CardFace task={task} s={s} end={end} clock={clock} tags={tags} places={places} />
            </Animated.View>
          </GestureDetector>

          {/* When "Missed" occupies the corner, the checkbox drops to the bottom
              of the row so the two never collide on short cards. */}
          <Tappable
            onPress={() => props.onToggle(task.id)}
            hitSlop={8}
            scaleTo={0.82}
            style={[
              styles.check,
              missed && !hasMeta && styles.checkLow,
              { backgroundColor: task.done ? color : 'transparent', boxShadow: `inset 0 0 0 2px ${task.done ? color : hexA(color, 0.5)}` },
            ]}>
            {task.done && <Text style={styles.checkMark}>✓</Text>}
          </Tappable>
        </View>

        {task.subtasks.length > 0 && (
          <SubtaskStrip task={task} onToggleExpanded={() => props.onToggleExpanded(task.id)} onToggleSubtask={(sid) => props.onToggleSubtask(task.id, sid)} />
        )}

        {/* Grayscale + dim via blend overlays (no content copy). */}
        {oh >= 2 && (
          <>
            <View pointerEvents="none" style={[styles.desat, { height: oh }]} />
            <View pointerEvents="none" style={[styles.dim, { height: oh, backgroundColor: `rgba(11,11,13,${dimAlpha})` }]} />
          </>
        )}

        {hasNote && (
          <View pointerEvents="none" style={styles.noteBadge}>
            <Feather name="file-text" size={10} color={C.muted} />
          </View>
        )}

        {missed && <MissedBadge />}
      </Animated.View>
    </Animated.View>
  );
}

export const TaskCard = React.memo(TaskCardBase);

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 56, right: 16 },
  card: {
    position: 'relative',
    overflow: 'hidden',
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: C.card,
  },
  cardMain: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  subStrip: { marginTop: 8, paddingLeft: 2 },
  subToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 22, alignSelf: 'flex-start' },
  subToggleTxt: { fontSize: 12, fontWeight: '700', color: C.muted },
  subItem: { flexDirection: 'row', alignItems: 'center', gap: 9, height: SUB_ROW_H },
  subDot: { width: 17, height: 17, borderRadius: 5, borderWidth: 2, borderColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
  subItemTxt: { fontSize: 13, color: C.textDim, flex: 1 },
  subItemDone: { color: C.faint, textDecorationLine: 'line-through' },
  // 'saturation' blend with a neutral-gray fill desaturates the backdrop in
  // this region (the elapsed part of the card); the dim adds the "past" fade.
  desat: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: '#808080', mixBlendMode: 'saturation' },
  dim: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: 'rgba(11,11,13,0.32)' },
  // "Missed": the wrap is sized just a little larger than the chip and centred
  // on it, so the striped halo hugs the chip.
  missedWrap: { position: 'absolute', top: -3, right: -6, width: 76, height: 38, alignItems: 'center', justifyContent: 'center' },
  missedBadge: { backgroundColor: 'rgba(40,16,19,0.92)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, boxShadow: 'inset 0 0 0 1px rgba(255,90,95,0.45)' },
  missedTxt: { fontSize: 9.5, fontWeight: '800', color: '#ff5a5f', letterSpacing: 0.4 },
  noteBadge: { position: 'absolute', top: 6, left: 6, width: 18, height: 18, borderRadius: 6, backgroundColor: 'rgba(20,21,24,0.82)', alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1)' },
  grab: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 11 },
  icon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  iconTxt: { fontSize: 20 },
  body: { flex: 1, minWidth: 0 },
  title: { fontSize: 15.5, fontWeight: '600', letterSpacing: -0.2, color: C.text },
  strike: { textDecorationLine: 'line-through', color: '#6a6a72' },
  timeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  time: { fontSize: 12.5, color: C.muted, fontVariant: ['tabular-nums'] },
  dur: { color: C.faint },
  repeatIcon: { marginLeft: 5 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 5 },
  chip: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 7, borderWidth: 1 },
  chipTxt: { fontSize: 10, fontWeight: '600' },
  placeChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.12)' },
  placeTxt: { fontSize: 10, fontWeight: '600', color: C.muted },
  check: { width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  checkLow: { alignSelf: 'flex-end' },
  checkMark: { fontSize: 14, color: '#0b0b0d', fontWeight: '700' },
});
