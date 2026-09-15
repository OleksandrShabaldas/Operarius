import React, { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
import { LinearGradient } from 'expo-linear-gradient';
import { Place, Tag, Task } from '../types';
import { C, PX } from '../theme';
import { fmt, fmtDur, hexA, placeLabel, tagLabel } from '../utils';
import { Pos } from '../layout';

type Props = {
  task: Task;
  tags: Tag[];
  places: Place[];
  pos: Pos;
  isDragging: boolean;
  nowMin: number | null; // null when the viewed day is not today
  dayStart: number;
  dayEnd: number;
  liveStart: number; // start minute to display (drag-aware)
  onDragStart: (id: string) => void;
  onDragMove: (id: string, min: number) => void;
  onDragEnd: (id: string) => void;
  onEdit: (id: string) => void;
  onToggle: (id: string) => void;
};

function TaskCardBase({
  task,
  tags,
  places,
  pos,
  isDragging,
  nowMin,
  dayStart,
  dayEnd,
  liveStart,
  onDragStart,
  onDragMove,
  onDragEnd,
  onEdit,
  onToggle,
}: Props) {
  const topSV = useSharedValue(pos.top);
  const scale = useSharedValue(1);
  const origRef = useRef(task.start);
  const lastMinRef = useRef(task.start);
  const draggingRef = useRef(false);

  useEffect(() => {
    if (isDragging) {
      topSV.value = pos.top;
    } else {
      topSV.value = withTiming(pos.top, { duration: 200, easing: Easing.out(Easing.cubic) });
    }
  }, [pos.top, isDragging, topSV]);

  const beginDrag = () => {
    draggingRef.current = true;
    origRef.current = task.start;
    lastMinRef.current = task.start;
    scale.value = withSpring(1.03, { damping: 18, stiffness: 260 });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onDragStart(task.id);
  };
  const moveDrag = (dy: number) => {
    if (!draggingRef.current) return;
    let nm = Math.round((origRef.current + dy / PX) / 5) * 5;
    nm = Math.max(dayStart - 45, Math.min(dayEnd - 15, nm));
    if (nm !== lastMinRef.current) {
      lastMinRef.current = nm;
      onDragMove(task.id, nm);
    }
  };
  const endDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    scale.value = withSpring(1, { damping: 18, stiffness: 260 });
    onDragEnd(task.id);
  };
  const edit = () => onEdit(task.id);

  const pan = Gesture.Pan()
    .activateAfterLongPress(320)
    .onStart(() => {
      'worklet';
      runOnJS(beginDrag)();
    })
    .onUpdate((e) => {
      'worklet';
      runOnJS(moveDrag)(e.translationY);
    })
    .onFinalize(() => {
      'worklet';
      runOnJS(endDrag)();
    });
  const tap = Gesture.Tap().onEnd((_e, success) => {
    'worklet';
    if (success) runOnJS(edit)();
  });
  const gesture = Gesture.Exclusive(pan, tap);

  const wrapStyle = useAnimatedStyle(() => ({ top: topSV.value }));
  const cardAnim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const color = task.color;
  const s = liveStart;
  const end = s + task.dur;

  // Fully-elapsed tasks (today only) are desaturated and dimmed.
  const isPast = nowMin != null && end <= nowMin && !isDragging;

  const tagTxt = tagLabel(tags, task.tagId);
  const placeTxt = placeLabel(places, task.placeId);

  const cardShadow = isPast
    ? 'inset 0 0 0 1px rgba(255,255,255,0.05)'
    : `inset 0 0 0 1px ${hexA(color, isDragging ? 0.45 : 0.16)}, 0 0 24px -6px ${hexA(
        color,
        isDragging ? 0.65 : 0.3
      )}${isDragging ? ', 0 22px 44px -12px rgba(0,0,0,.85)' : ''}`;

  const iconColors: [string, string] = isPast
    ? ['#34343c', '#26262c']
    : [color, hexA(color, 0.72)];

  return (
    <Animated.View style={[styles.wrap, wrapStyle, { zIndex: isDragging ? 50 : 2 }]}>
      <Animated.View
        style={[
          styles.card,
          cardAnim,
          { minHeight: pos.h, boxShadow: cardShadow },
          isPast && styles.pastCard,
        ]}>
        <GestureDetector gesture={gesture}>
          <Animated.View style={styles.grab}>
            <LinearGradient
              colors={iconColors}
              start={{ x: 0.1, y: 0 }}
              end={{ x: 0.9, y: 1 }}
              style={[
                styles.icon,
                !isPast && { boxShadow: `0 5px 16px -3px ${hexA(color, 0.85)}, 0 0 0 1px ${hexA(color, 0.3)}` },
              ]}>
              <Text style={styles.iconTxt}>{task.emoji}</Text>
            </LinearGradient>
            <View style={styles.body}>
              <Text
                numberOfLines={1}
                style={[styles.title, (task.done || isPast) && styles.titleMuted, task.done && styles.strike]}>
                {task.title}
              </Text>
              <Text numberOfLines={1} style={styles.time}>
                {fmt(s)} – {fmt(end)} <Text style={styles.dur}>· {fmtDur(task.dur)}</Text>
              </Text>
              {(!!tagTxt || !!placeTxt) && (
                <View style={styles.metaRow}>
                  {!!tagTxt && (
                    <View
                      style={[
                        styles.chip,
                        isPast
                          ? { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.12)' }
                          : { backgroundColor: hexA(color, 0.15), borderColor: hexA(color, 0.28) },
                      ]}>
                      <Text style={[styles.chipTxt, { color: isPast ? C.muted : color }]}>{tagTxt}</Text>
                    </View>
                  )}
                  {!!placeTxt && (
                    <View style={[styles.chip, { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.12)' }]}>
                      <Text style={styles.placeTxt}>📍 {placeTxt}</Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          </Animated.View>
        </GestureDetector>

        <Pressable
          onPress={() => onToggle(task.id)}
          hitSlop={8}
          style={[
            styles.check,
            {
              backgroundColor: task.done ? color : 'transparent',
              boxShadow: `inset 0 0 0 2px ${task.done ? color : hexA(color, 0.5)}`,
            },
          ]}>
          {task.done && <Text style={styles.checkMark}>✓</Text>}
        </Pressable>
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
  pastCard: { filter: [{ grayscale: 1 }], opacity: 0.5, backgroundColor: '#131316' },
  grab: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 11 },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconTxt: { fontSize: 20 },
  body: { flex: 1, minWidth: 0 },
  title: { fontSize: 15.5, fontWeight: '600', letterSpacing: -0.2, color: C.text },
  titleMuted: { color: '#7a7a82' },
  strike: { textDecorationLine: 'line-through', color: '#6a6a72' },
  time: { fontSize: 12.5, color: C.muted, marginTop: 3, fontVariant: ['tabular-nums'] },
  dur: { color: C.faint },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  chip: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  chipTxt: { fontSize: 11, fontWeight: '600' },
  placeTxt: { fontSize: 11, fontWeight: '600', color: C.textDim },
  check: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: { fontSize: 14, color: '#0b0b0d', fontWeight: '700' },
});
