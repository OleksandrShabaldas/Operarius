import React, { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, LinearTransition, runOnJS, runOnUI, SharedValue, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { ms, sp } from '../motion';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Clock, Place, Tag, Task } from '../types';
import { C, LANE_R, PILL_GAP, PILL_L, PILL_W } from '../theme';
import { fmt, fmtDur, findTag, hexA, placeLabel, shade, tagLabel } from '../utils';
import { INTENSITY_COLOR, remindsAtAll } from '../reminders';
import { openSubtasks } from '../recurrence';
import { Pos } from '../layout';
import { PlaceIcon } from './PlaceIcon';
import { Stripes } from './Stripes';
import { Appear, stagger, Tappable } from './anim';
import { TaskCheck } from './TaskCheck';

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
  // While lifted over a task it would fuse *beneath*, the card leaves the
  // finger and settles into that slot, so the stack (and its overlap band)
  // shows exactly what dropping there does.
  dragSnapTop?: number | null;
  dragJoin?: { top: boolean; bottom: boolean }; // lifted: edges fused to an overlap band at the landing spot
  dragOverlap?: boolean; // lifted: the landing time overlaps another task
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

// Text content of a card: title, time (+ repeat / reminder / notes marks), meta chips.
function CardFace({ task, s, end, clock, tags, places, past }: { task: Task; s: number; end: number; clock: Clock; tags: Tag[]; places: Place[]; past: boolean }) {
  const tag = findTag(tags, task.tagId);
  const tagColor = tag?.color || task.color;
  const placeTxt = placeLabel(places, task.placeId);
  return (
    <View style={styles.body}>
      <Text numberOfLines={1} style={[styles.title, task.done && styles.strike]}>
        {task.title}
      </Text>
      <View style={styles.timeRow}>
        <Text numberOfLines={1} style={styles.time}>
          {fmt(s, clock)} – {fmt(end, clock)} <Text style={styles.dur}>· {fmtDur(task.dur)}</Text>
        </Text>
        {!!task.repeat && <Feather name="repeat" size={10.5} color={C.muted} style={styles.mark} />}
        {remindsAtAll(task) && !task.done && <Feather name="bell" size={10.5} color={past ? C.faint : INTENSITY_COLOR[task.reminders!.intensity]} style={styles.mark} />}
        {!!task.notes.trim() && <Feather name="file-text" size={10.5} color={C.muted} style={styles.mark} />}
      </View>
      {(!!tag || !!placeTxt) && (
        <View style={styles.metaRow}>
          {!!tag && (
            <View
              style={[
                styles.chip,
                {
                  backgroundColor: hexA(tagColor, 0.15),
                  borderColor: hexA(tagColor, 0.28),
                },
              ]}>
              <Text style={[styles.chipTxt, { color: tagColor }]}>{tagLabel(tag)}</Text>
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
  );
}

// Inline subtask strip at the bottom of a card: a "n/m subtasks" toggle that
// expands to show tappable subtask rows. Expanded state is persisted per task.
// `nudge` bumps when the task was ticked with subtasks still open: the strip
// then says what's left and the open boxes light up.
function SubtaskStrip({
  task,
  collapsed,
  nudge,
  onToggleExpanded,
  onToggleSubtask,
}: {
  task: Task;
  collapsed?: boolean; // held in a drag: keep the card compact
  nudge: number;
  onToggleExpanded: () => void;
  onToggleSubtask: (subId: string) => void;
}) {
  const done = task.subtasks.filter((s) => s.done).length;
  const total = task.subtasks.length;
  const left = total - done;
  const open = task.expanded && !collapsed;
  const [hint, setHint] = useState(false);
  useEffect(() => {
    if (!nudge) return;
    setHint(true);
    const t = setTimeout(() => setHint(false), 2400);
    return () => clearTimeout(t);
  }, [nudge]);
  const warn = hint && left > 0;
  // Ticking the last open subtask completes the task — that one lands firmer.
  const tick = (id: string, wasDone: boolean) => {
    if (!wasDone && left === 1) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    else Haptics.selectionAsync().catch(() => {});
    onToggleSubtask(id);
  };
  return (
    <View style={styles.subStrip}>
      <View style={styles.subHead}>
        <Tappable onPress={onToggleExpanded} hitSlop={6} style={styles.subToggle}>
          <Feather name={open ? 'chevron-up' : 'chevron-down'} size={13} color={C.muted} />
          <Text style={styles.subToggleTxt}>
            {done}/{total} subtasks
          </Text>
        </Tappable>
        {warn && (
          <Appear key={nudge} from="left" distance={10} style={styles.subHint}>
            <Feather name="lock" size={10} color={C.now} />
            <Text numberOfLines={1} style={styles.subHintTxt}>
              {left === 1 ? 'Finish the last one first' : `Finish these ${left} first`}
            </Text>
          </Appear>
        )}
      </View>
      {open &&
        task.subtasks.map((sub) => (
          <Tappable key={sub.id} onPress={() => tick(sub.id, sub.done)} hitSlop={4} style={styles.subItem}>
            <View
              style={[
                styles.subDot,
                sub.done && {
                  backgroundColor: task.color,
                  borderColor: task.color,
                },
                warn && !sub.done && styles.subDotWarn,
              ]}>
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

// "Missed" chip in the top-right corner, with a faint halo of red warning
// stripes centred on it that fades out long before the card's edges.
function MissedBadge() {
  return (
    <View pointerEvents="none" style={styles.missedWrap}>
      <Stripes color={C.now} opacity={0.42} spacing={4} strokeWidth={0.8} fade="radial-faint" style={StyleSheet.absoluteFill} />
      <View style={styles.missedBadge}>
        <Text style={styles.missedTxt}>Missed</Text>
      </View>
    </View>
  );
}

// Grayscale + dim over the elapsed part of a card or pill (blend overlays, no
// content copy). `h` null = the whole thing.
function Elapsed({ h, alpha }: { h: number | null; alpha: number }) {
  const size = h == null ? styles.fullH : { height: h };
  return (
    <>
      <View pointerEvents="none" style={[styles.desat, size]} />
      <View pointerEvents="none" style={[styles.dim, size, { backgroundColor: `rgba(11,11,13,${alpha})` }]} />
    </>
  );
}

function TaskCardBase(props: Props) {
  const { task, tags, places, clock, pos, isDragging, nowMin, liveStart, scrollY } = props;
  const snapped = isDragging && props.dragSnapTop != null;

  // Resting position is animated; while lifted, the card is positioned on the
  // UI thread from the finger (base + dy + auto-scroll) — no React in the loop.
  // Over a task it would fuse beneath, it eases into that slot instead (snapMix).
  const topSV = useSharedValue(pos.top);
  const baseS = useSharedValue(pos.top);
  const dyS = useSharedValue(0);
  const scroll0 = useSharedValue(0);
  const dragging = useSharedValue(0);
  const snapTop = useSharedValue(0);
  const snapMix = useSharedValue(0);
  const scale = useSharedValue(1);
  const draggingRef = useRef(false);
  const [endTick, setEndTick] = useState(0);
  const [nudge, setNudge] = useState(0);

  // Settle into the resting slot. After a drop, start from exactly where the
  // card is on screen (atomically on the UI thread) so it glides, never jumps.
  useEffect(() => {
    if (isDragging) return;
    const target = pos.top;
    const duration = ms(240);
    runOnUI(() => {
      'worklet';
      if (dragging.value) {
        const finger = baseS.value + dyS.value + (scrollY.value - scroll0.value);
        topSV.value = finger + (snapTop.value - finger) * snapMix.value;
        dragging.value = 0;
        snapMix.value = 0;
      }
      topSV.value = withTiming(target, {
        duration,
        easing: Easing.out(Easing.cubic),
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos.top, isDragging, endTick]);

  // Once lifted, glide the drag anchor to where this task's time sits on the
  // drag ruler, so the finger→time mapping is exact from the first move.
  useEffect(() => {
    if (isDragging && props.dragBaseY != null) {
      baseS.value = withTiming(props.dragBaseY, {
        duration: ms(170),
        easing: Easing.out(Easing.cubic),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging, props.dragBaseY]);

  // Fused beneath another task while held: ease into the slot (following it as
  // the overlap changes) and sit flush in the stack; back to the finger once
  // it no longer lands inside that task.
  useEffect(() => {
    if (!isDragging) return;
    const lift = sp({ damping: 18, stiffness: 260 });
    if (props.dragSnapTop != null) {
      snapTop.value =
        snapMix.value > 0.02
          ? withTiming(props.dragSnapTop, {
              duration: ms(160),
              easing: Easing.out(Easing.cubic),
            })
          : props.dragSnapTop;
      snapMix.value = withSpring(1, sp({ damping: 21, stiffness: 250 }));
      scale.value = withSpring(1, lift);
    } else {
      snapMix.value = withSpring(0, sp({ damping: 21, stiffness: 250 }));
      scale.value = withSpring(1.03, lift);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging, props.dragSnapTop]);

  const subTotal = task.subtasks.length;
  const subLeft = openSubtasks(task);

  const beginDrag = () => {
    draggingRef.current = true;
    scale.value = withSpring(1.03, sp({ damping: 18, stiffness: 260 }));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    props.onDragStart(task.id);
  };
  const moveDrag = (dy: number, absY: number) => {
    if (draggingRef.current) props.onDragMove(task.id, dy, absY);
  };
  const endDrag = () => {
    scale.value = withSpring(1, sp({ damping: 18, stiffness: 260 }));
    if (draggingRef.current) {
      draggingRef.current = false;
      Haptics.selectionAsync().catch(() => {});
      props.onDragEnd(task.id);
    }
    setEndTick((n) => n + 1);
  };
  const open = () => props.onOpen(task.id);

  // The pill and the card are both handles (long-press to drag, tap to open);
  // each detector needs its own gesture instance.
  const makeGesture = () => {
    const pan = Gesture.Pan()
      .activateAfterLongPress(320)
      .onStart(() => {
        'worklet';
        baseS.value = topSV.value;
        dyS.value = 0;
        scroll0.value = scrollY.value;
        snapMix.value = 0;
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
    return Gesture.Exclusive(pan, tap);
  };

  // A task is complete only once all its subtasks are: ticking it with some
  // still open (the box shakes) folds the subtasks open and says what's left.
  const blocked = () => {
    if (!task.expanded) props.onToggleExpanded(task.id);
    setNudge((n) => n + 1);
  };

  const wrapStyle = useAnimatedStyle(() => {
    if (!dragging.value) return { top: topSV.value };
    const finger = baseS.value + dyS.value + (scrollY.value - scroll0.value);
    return { top: finger + (snapTop.value - finger) * snapMix.value };
  });
  const liftStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

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
  // Elapsed overlay: null = all of it; a number = that many px from the top
  // (in step with the now line, which crosses the card at the same height).
  let elapsed: number | null | undefined;
  if (!isDragging) {
    if (task.done || isPastDay) elapsed = null;
    else if (inProgress) {
      const h = Math.round(((nowMin! - s) / task.dur) * pos.h);
      if (h >= 2) elapsed = h;
    }
  }
  const dimAlpha = task.done ? (past ? 0.46 : 0.2) : isPastDay ? 0.42 : 0.32;
  const grey = task.done || isPastDay;

  // Fused edges (overlap stacks) square off so the stack reads as one shape —
  // also for the held card at a landing spot where it fuses.
  const joinTop = isDragging ? !!props.dragJoin?.top : !!pos.joinTop;
  const joinBottom = isDragging ? !!props.dragJoin?.bottom : !!pos.joinBottom;
  const radii = {
    borderTopLeftRadius: joinTop ? 0 : 16,
    borderTopRightRadius: joinTop ? 0 : 16,
    borderBottomLeftRadius: joinBottom ? 0 : 16,
    borderBottomRightRadius: joinBottom ? 0 : 16,
  };

  // Held over another task's time: its edge and glow turn red ("this will
  // overlap"); floating free it casts a deep shadow, settled in a stack none.
  // Glows live on an outer shell and the content (with the greying blend
  // overlays) in an inner layer: Android draws a view whose children blend into
  // a layer clipped to its box, which would cut its own glow off at the edges.
  const warn = isDragging && !!props.dragOverlap;
  const edge = warn ? C.now : color;
  const cardRing = `inset 0 0 0 1px ${hexA(edge, isDragging ? 0.55 : 0.16)}`;
  // A greyed (done / past) task keeps its depth but loses its coloured halo.
  // (Same shadow list either way — a removed boxShadow can linger on Android.)
  const cardGlow = `0 0 24px -6px ${grey && !isDragging ? 'rgba(0,0,0,0)' : hexA(edge, isDragging ? 0.7 : 0.3)}` + (isDragging && !snapped ? ', 0 22px 44px -12px rgba(0,0,0,.85)' : '');
  const pillGlow = `0 6px 16px -6px ${grey && !isDragging ? 'rgba(0,0,0,0.55)' : hexA(color, 0.85)}` + (warn ? `, 0 0 0 2px ${hexA(C.now, 0.75)}` : '') + (isDragging && !snapped ? ', 0 18px 34px -12px rgba(0,0,0,.8)' : '');

  // Height changes (subtasks folding open/closed) glide, pill and card in step.
  // Native only: the web implementation measures on-screen rects, which scrolling shifts.
  const lt = Platform.OS === 'web' ? undefined : LinearTransition.duration(ms(220)).easing(Easing.out(Easing.cubic));

  return (
    <Animated.View style={[styles.wrap, wrapStyle, { zIndex: isDragging ? 50 : 2 }]} entering={stagger(props.index)}>
      <Animated.View style={[styles.row, liftStyle]}>
        {/* The task's colour + icon, standing on the timeline rail. */}
        <GestureDetector gesture={makeGesture()}>
          <Animated.View layout={lt} style={[styles.pill, { height: pos.h, boxShadow: pillGlow }]}>
            <View style={styles.pillInner}>
              {/* Opaque, so nothing shows through while it's carried over the day. */}
              <LinearGradient colors={[color, shade(color, 0.28)]} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={StyleSheet.absoluteFill} />
              <Text style={styles.pillTxt}>{task.emoji}</Text>
              {elapsed !== undefined && <Elapsed h={elapsed} alpha={dimAlpha} />}
            </View>
          </Animated.View>
        </GestureDetector>

        <Animated.View layout={lt} style={[styles.cardShell, radii, { minHeight: pos.h, boxShadow: cardGlow }]}>
          <View style={[styles.card, radii, { boxShadow: cardRing }]}>
            {/* A breath of the task's colour, continuing from its pill. */}
            <LinearGradient pointerEvents="none" colors={[hexA(color, 0.075), hexA(color, 0)]} start={{ x: 0, y: 0 }} end={{ x: 0.5, y: 0 }} style={StyleSheet.absoluteFill} />

            <View style={styles.cardMain}>
              <GestureDetector gesture={makeGesture()}>
                <Animated.View style={styles.grab}>
                  <CardFace task={task} s={s} end={end} clock={clock} tags={tags} places={places} past={isPastDay} />
                </Animated.View>
              </GestureDetector>

              {/* When "Missed" occupies the corner, the checkbox drops to the bottom
                  of the row so the two never collide on short cards. */}
              <View style={missed && !hasMeta ? styles.checkLow : null}>
                <TaskCheck color={color} done={task.done} subTotal={subTotal} subLeft={subLeft} onToggle={() => props.onToggle(task.id)} onBlocked={blocked} />
              </View>
            </View>

            {subTotal > 0 && (
              <SubtaskStrip task={task} collapsed={isDragging} nudge={nudge} onToggleExpanded={() => props.onToggleExpanded(task.id)} onToggleSubtask={(sid) => props.onToggleSubtask(task.id, sid)} />
            )}

            {elapsed !== undefined && <Elapsed h={elapsed} alpha={dimAlpha} />}

            {missed && <MissedBadge />}
          </View>
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
}

// Layout objects are rebuilt on every drag step; compare the slot by value so
// only cards that actually move or change re-render.
const samePos = (a: Pos, b: Pos) => a.top === b.top && a.h === b.h && !!a.joinTop === !!b.joinTop && !!a.joinBottom === !!b.joinBottom;
const sameJoin = (a?: { top: boolean; bottom: boolean }, b?: { top: boolean; bottom: boolean }) => !!a?.top === !!b?.top && !!a?.bottom === !!b?.bottom;
export const TaskCard = React.memo(TaskCardBase, (prev, next) => {
  for (const k of Object.keys(next) as (keyof Props)[]) {
    if (k === 'index') continue; // only used for the mount stagger
    if (k === 'pos') {
      if (!samePos(prev.pos, next.pos)) return false;
    } else if (k === 'dragJoin') {
      if (!sameJoin(prev.dragJoin, next.dragJoin)) return false;
    } else if (prev[k] !== next[k]) return false;
  }
  return true;
});

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: PILL_L, right: LANE_R },
  row: { flexDirection: 'row', gap: PILL_GAP },
  // Emoji centred on the card's title + time lines (the middle of a minimum-height card).
  // Exactly the slot's height (the card is sized to it too): a pill stretched by
  // the row picks up in-between layouts, and its glow can keep a stale outline.
  pill: { width: PILL_W, alignSelf: 'flex-start', borderRadius: PILL_W / 2 },
  pillInner: {
    flex: 1,
    borderRadius: PILL_W / 2,
    overflow: 'hidden',
    alignItems: 'center',
    paddingTop: 17,
  },
  pillTxt: { fontSize: 19, lineHeight: 26 },
  cardShell: { flex: 1 },
  card: {
    flexGrow: 1,
    position: 'relative',
    overflow: 'hidden',
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: C.card,
  },
  cardMain: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  subStrip: { marginTop: 8, paddingLeft: 2 },
  subHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  subToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 22,
    alignSelf: 'flex-start',
  },
  subToggleTxt: { fontSize: 12, fontWeight: '700', color: C.muted },
  subHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
  },
  subHintTxt: { fontSize: 11, fontWeight: '700', color: C.now, flexShrink: 1 },
  subItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    height: SUB_ROW_H,
  },
  subDot: {
    width: 17,
    height: 17,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  subDotWarn: { borderColor: hexA(C.now, 0.85) },
  subItemTxt: { fontSize: 13, color: C.textDim, flex: 1 },
  subItemDone: { color: C.faint, textDecorationLine: 'line-through' },
  // 'saturation' blend with a neutral-gray fill desaturates the backdrop in
  // this region (the elapsed part); the dim adds the "past" fade.
  desat: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#808080',
    mixBlendMode: 'saturation',
  },
  dim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(11,11,13,0.32)',
  },
  fullH: { bottom: 0 },
  // "Missed": the halo is a flat ellipse centred on the chip, so its fade has
  // died away before the card's clipped edges (no visible cut at the border).
  missedWrap: {
    position: 'absolute',
    top: -4,
    right: -20,
    width: 104,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  missedBadge: {
    backgroundColor: 'rgba(40,16,19,0.92)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    boxShadow: 'inset 0 0 0 1px rgba(255,90,95,0.45)',
  },
  missedTxt: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#ff5a5f',
    letterSpacing: 0.4,
  },
  grab: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  body: { flex: 1, minWidth: 0 },
  title: {
    fontSize: 15.5,
    fontWeight: '600',
    letterSpacing: -0.2,
    color: C.text,
  },
  strike: { textDecorationLine: 'line-through', color: '#6a6a72' },
  timeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  time: { fontSize: 12.5, color: C.muted, fontVariant: ['tabular-nums'] },
  dur: { color: C.faint },
  mark: { marginLeft: 5 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 5 },
  chip: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 7,
    borderWidth: 1,
  },
  chipTxt: { fontSize: 10, fontWeight: '600' },
  placeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: 'rgba(255,255,255,0.12)',
  },
  placeTxt: { fontSize: 10, fontWeight: '600', color: C.muted },
  checkLow: { alignSelf: 'flex-end' },
});
