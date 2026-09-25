import React, { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, Easing, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { C } from '../theme';
import { motion, ms, sp, spW } from '../motion';
import { hexA } from '../utils';
import { Tappable } from './anim';

/** How long a deletion can be undone (real time — it doesn't follow the animation speed). */
export const UNDO_MS = 5000;

export type UndoItem = { n: number; title: string; emoji: string; color: string };

// ---------------------------------------------------------------------------
// "Task deleted — Undo": floats above the tab bar for a few seconds after a
// task is deleted, a line running down the time left. Swipe it down to let it
// go early.
// ---------------------------------------------------------------------------
export function UndoBar({ item, onUndo, onClose }: { item: UndoItem | null; onUndo: () => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, 10) + 6 + 92; // above the + button
  if (!item) return null;
  return <Bar key={item.n} item={item} bottom={bottom} onUndo={onUndo} onClose={onClose} />;
}

function Bar({ item, bottom, onUndo, onClose }: { item: UndoItem; bottom: number; onUndo: () => void; onClose: () => void }) {
  const p = useSharedValue(0); // in / out
  const drag = useSharedValue(0);
  const left = useSharedValue(1); // time left, 1 → 0
  const closing = useRef(false);

  const close = (then?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    cancelAnimation(left);
    p.value = withTiming(0, { duration: ms(200), easing: Easing.in(Easing.cubic) }, (f) => {
      'worklet';
      if (f) runOnJS(onClose)();
    });
    then?.();
  };
  const closeRef = useRef(close);
  closeRef.current = close;
  const dismiss = useCallback(() => closeRef.current(), []);

  useEffect(() => {
    p.value = withSpring(1, sp({ damping: 17, stiffness: 240, mass: 0.8 }));
    left.value = withTiming(0, { duration: UNDO_MS, easing: Easing.linear });
    const t = setTimeout(() => closeRef.current(), UNDO_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const swipe = Gesture.Pan()
    .activeOffsetY(8)
    .onUpdate((e) => {
      'worklet';
      drag.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      'worklet';
      if (e.translationY > 40 || e.velocityY > 500) runOnJS(dismiss)();
      else drag.value = withSpring(0, spW({ damping: 18, stiffness: 260 }));
    });

  const wrap = useAnimatedStyle(() => ({
    opacity: Math.min(1, p.value * 1.3) * (1 - Math.min(1, drag.value / 90)),
    transform: [{ translateY: (1 - p.value) * 28 + drag.value }, { scale: 0.94 + 0.06 * p.value }],
  }));
  const bar = useAnimatedStyle(() => ({ transform: [{ scaleX: left.value }] }));

  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, styles.layer]}>
      <GestureDetector gesture={swipe}>
        <Animated.View style={[styles.card, { bottom }, wrap]}>
          <LinearGradient colors={[item.color, hexA(item.color, 0.72)]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={styles.icon}>
            <Text style={styles.emoji}>{item.emoji}</Text>
          </LinearGradient>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Task deleted</Text>
            <Text style={styles.sub} numberOfLines={1}>
              {item.title}
            </Text>
          </View>
          <Tappable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              close(onUndo);
            }}
            style={styles.undo}
            hitSlop={8}>
            <Feather name="rotate-ccw" size={14} color={C.accentB} />
            <Text style={styles.undoTxt}>Undo</Text>
          </Tappable>
          <View style={styles.track}>{motion.enabled && <Animated.View style={[styles.left, bar]} />}</View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { zIndex: 60 },
  card: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 10,
    paddingRight: 8,
    paddingVertical: 10,
    borderRadius: 18,
    backgroundColor: '#1d1e23',
    boxShadow: '0 16px 36px -12px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(255,255,255,0.08)',
  },
  icon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 18 },
  title: { fontSize: 14, fontWeight: '800', color: C.text },
  sub: { fontSize: 12.5, color: C.muted, marginTop: 1 },
  undo: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 38, borderRadius: 12, backgroundColor: 'rgba(79,209,197,0.14)' },
  undoTxt: { fontSize: 14, fontWeight: '800', color: C.accentB },
  track: { position: 'absolute', left: 16, right: 16, bottom: 4, height: 2.5, borderRadius: 2, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.06)' },
  left: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: C.accentB, transformOrigin: 'left' },
});
