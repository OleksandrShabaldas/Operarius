import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Clock, Place, Tag, Task } from '../types';
import { C, PX } from '../theme';
import { fmt, fmtDur, findTag, hexA, placeLabel } from '../utils';
import { Pos } from '../layout';
import { PlaceIcon } from './PlaceIcon';
import { Hatch } from './Hatch';
import { stagger, Tappable } from './anim';

export type DayState = 'past' | 'today' | 'future';

type Props = {
  task: Task;
  index: number;
  tags: Tag[];
  places: Place[];
  clock: Clock;
  pos: Pos;
  isDragging: boolean;
  nowMin: number | null; // null when the viewed day is not today
  dayState: DayState;
  dayStart: number;
  dayEnd: number;
  liveStart: number;
  onDragStart: (id: string) => void;
  onDragMove: (id: string, min: number) => void;
  onDragEnd: (id: string) => void;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
};

// Visual content of a card (icon + text + meta). Rendered once for the colored
// card and again inside a clipped, grayscale-filtered overlay for the elapsed
// portion (so a task straddling "now" is gray above the line, colored below).
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

function TaskCardBase(props: Props) {
  const { task, tags, places, clock, pos, isDragging, nowMin, dayStart, dayEnd, liveStart } = props;
  const topSV = useSharedValue(pos.top);
  const scale = useSharedValue(1);
  const origRef = useRef(task.start);
  const lastMinRef = useRef(task.start);
  const draggingRef = useRef(false);

  useEffect(() => {
    if (isDragging) topSV.value = pos.top;
    else topSV.value = withTiming(pos.top, { duration: 200, easing: Easing.out(Easing.cubic) });
  }, [pos.top, isDragging, topSV]);

  const beginDrag = () => {
    draggingRef.current = true;
    origRef.current = task.start;
    lastMinRef.current = task.start;
    scale.value = withSpring(1.03, { damping: 18, stiffness: 260 });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    props.onDragStart(task.id);
  };
  const moveDrag = (dy: number) => {
    if (!draggingRef.current) return;
    let nm = Math.round((origRef.current + dy / PX) / 5) * 5;
    nm = Math.max(dayStart - 45, Math.min(dayEnd - 15, nm));
    if (nm !== lastMinRef.current) {
      lastMinRef.current = nm;
      props.onDragMove(task.id, nm);
    }
  };
  const endDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    scale.value = withSpring(1, { damping: 18, stiffness: 260 });
    props.onDragEnd(task.id);
  };
  const open = () => props.onOpen(task.id);

  const pan = Gesture.Pan()
    .activateAfterLongPress(320)
    .onStart(() => { 'worklet'; runOnJS(beginDrag)(); })
    .onUpdate((e) => { 'worklet'; runOnJS(moveDrag)(e.translationY); })
    .onFinalize(() => { 'worklet'; runOnJS(endDrag)(); });
  const tap = Gesture.Tap().onEnd((_e, ok) => { 'worklet'; if (ok) runOnJS(open)(); });
  const gesture = Gesture.Exclusive(pan, tap);

  const wrapStyle = useAnimatedStyle(() => ({ top: topSV.value }));
  const cardAnim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const color = task.color;
  const s = liveStart;
  const end = s + task.dur;

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

  const cardShadow = `inset 0 0 0 1px ${hexA(color, isDragging ? 0.45 : 0.16)}, 0 0 24px -6px ${hexA(color, isDragging ? 0.65 : 0.3)}${isDragging ? ', 0 22px 44px -12px rgba(0,0,0,.85)' : ''}`;

  return (
    <Animated.View style={[styles.wrap, wrapStyle, { zIndex: isDragging ? 50 : 2 }]} entering={stagger(props.index)}>
      <Animated.View style={[styles.card, cardAnim, { minHeight: pos.h, boxShadow: cardShadow }]}>
        <GestureDetector gesture={gesture}>
          <Animated.View style={styles.grab}>
            <CardFace task={task} s={s} end={end} clock={clock} tags={tags} places={places} />
          </Animated.View>
        </GestureDetector>

        <Tappable
          onPress={() => props.onToggle(task.id)}
          hitSlop={8}
          scaleTo={0.82}
          style={[styles.check, { backgroundColor: task.done ? color : 'transparent', boxShadow: `inset 0 0 0 2px ${task.done ? color : hexA(color, 0.5)}` }]}>
          {task.done && <Text style={styles.checkMark}>✓</Text>}
        </Tappable>

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

        {missed && (
          <View pointerEvents="none" style={styles.missedWrap}>
            <Hatch color={C.now} opacity={0.06} radius={0} style={StyleSheet.absoluteFill} />
            <View style={styles.missedBadge}>
              <Text style={styles.missedTxt}>Missed</Text>
            </View>
          </View>
        )}
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: C.card,
  },
  // 'saturation' blend with a neutral-gray fill desaturates the backdrop in
  // this region (the elapsed part of the card); the dim adds the "past" fade.
  desat: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: '#808080', mixBlendMode: 'saturation' },
  dim: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: 'rgba(11,11,13,0.32)' },
  // "Missed": flush in the top-right corner, sitting over a heavily-faded red
  // warning hatch that blends into the card corner.
  missedWrap: { position: 'absolute', top: 0, right: 0, width: 96, height: 40, alignItems: 'flex-end', overflow: 'hidden', borderBottomLeftRadius: 18, borderTopRightRadius: 16 },
  missedBadge: { marginTop: 7, marginRight: 8, backgroundColor: 'rgba(255,90,95,0.18)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, boxShadow: 'inset 0 0 0 1px rgba(255,90,95,0.3)' },
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
  checkMark: { fontSize: 14, color: '#0b0b0d', fontWeight: '700' },
});
