import React, { useEffect, useRef } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { C } from '../theme';
import { ms, sp } from '../motion';
import { hexA } from '../utils';
import { Tappable } from './anim';

export const STAR = '#F2C14E';

// High-priority star: outlined when off; when switched on it pops, fills gold
// and sends out a soft ring.
export function StarToggle({ on, onToggle, size = 20, style }: { on: boolean; onToggle: () => void; size?: number; style?: StyleProp<ViewStyle> }) {
  const pop = useSharedValue(1);
  const ring = useSharedValue(1); // (1 = the ring's pulse is over: invisible until the next one)
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    pop.value = withSequence(withTiming(on ? 0.7 : 0.85, { duration: ms(70) }), withSpring(1, sp({ damping: 8, stiffness: 320 })));
    if (on) {
      ring.value = 0;
      ring.value = withTiming(1, { duration: ms(420) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);
  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  const ringStyle = useAnimatedStyle(() => ({ opacity: (1 - ring.value) * 0.8, transform: [{ scale: 0.6 + ring.value * 0.9 }] }));
  const press = () => {
    Haptics.impactAsync(on ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onToggle();
  };
  const box = size + 18;
  return (
    <Tappable onPress={press} hitSlop={8} scaleTo={0.88} style={[styles.btn, { width: box, height: box, borderRadius: box / 3 }, on && { backgroundColor: hexA(STAR, 0.14) }, style]}>
      <Animated.View pointerEvents="none" style={[styles.ring, { width: box, height: box, borderRadius: box / 2, borderColor: STAR }, ringStyle]} />
      <Animated.View style={iconStyle}>
        <Ionicons name={on ? 'star' : 'star-outline'} size={size} color={on ? STAR : C.muted} />
      </Animated.View>
    </Tappable>
  );
}

// The small gold star shown next to a starred task's name.
export function StarMark({ size = 12, style }: { size?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={style}>
      <Ionicons name="star" size={size} color={STAR} />
    </View>
  );
}

const styles = StyleSheet.create({
  btn: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)' },
  ring: { position: 'absolute', borderWidth: 1.5, opacity: 0 },
});
