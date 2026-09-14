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
import { Task } from '../types';
import { C, PX } from '../theme';
import { fmt, fmtDur, hexA } from '../utils';
import { Pos } from '../layout';

type Props = {
  task: Task;
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

  // Dragged card follows its (snapped) layout top immediately; others glide.
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

  // Elapsed scrim (only meaningful on "today").
  let oh = 0;
  if (nowMin != null) {
    const grayFrac = end <= nowMin ? 1 : s >= nowMin ? 0 : (nowMin - s) / task.dur;
    oh = Math.round(grayFrac * pos.h);
  }

  const cardShadow = `inset 0 0 0 1px ${hexA(color, isDragging ? 0.45 : 0.16)}, 0 0 24px -6px ${hexA(
    color,
    isDragging ? 0.65 : 0.3
  )}${isDragging ? ', 0 22px 44px -12px rgba(0,0,0,.85)' : ''}`;

  return (
    <Animated.View style={[styles.wrap, wrapStyle, { zIndex: isDragging ? 50 : 2 }]}>
      <Animated.View
        style={[
          styles.card,
          cardAnim,
          { minHeight: pos.h, boxShadow: cardShadow },
        ]}>
        <GestureDetector gesture={gesture}>
          <Animated.View style={styles.grab}>
            <LinearGradient
              colors={[color, hexA(color, 0.72)]}
              start={{ x: 0.1, y: 0 }}
              end={{ x: 0.9, y: 1 }}
              style={[styles.icon, { boxShadow: `0 5px 16px -3px ${hexA(color, 0.85)}, 0 0 0 1px ${hexA(color, 0.3)}` }]}>
              <Text style={styles.iconTxt}>{task.emoji}</Text>
            </LinearGradient>
            <View style={styles.body}>
              <Text
                numberOfLines={1}
                style={[styles.title, task.done && styles.titleDone]}>
                {task.title}
              </Text>
              <Text numberOfLines={1} style={styles.time}>
                {fmt(s)} – {fmt(end)} <Text style={styles.dur}>· {fmtDur(task.dur)}</Text>
              </Text>
              {!!task.tag && (
                <View
                  style={[
                    styles.tag,
                    { backgroundColor: hexA(color, 0.15), borderColor: hexA(color, 0.28) },
                  ]}>
                  <Text style={[styles.tagTxt, { color }]}>{task.tag}</Text>
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

        {oh >= 2 && (
          <View
            style={[
              styles.scrim,
              {
                height: oh,
                borderRadius: oh >= pos.h - 1 ? 16 : 0,
                borderTopLeftRadius: 16,
                borderTopRightRadius: 16,
              },
            ]}
          />
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
  titleDone: { color: '#6a6a72', textDecorationLine: 'line-through' },
  time: { fontSize: 12.5, color: C.muted, marginTop: 3, fontVariant: ['tabular-nums'] },
  dur: { color: C.faint },
  tag: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  tagTxt: { fontSize: 11, fontWeight: '600' },
  check: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: { fontSize: 14, color: '#0b0b0d', fontWeight: '700' },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(11,11,13,0.34)',
    pointerEvents: 'none',
  },
});
