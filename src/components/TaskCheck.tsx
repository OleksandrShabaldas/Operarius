import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { ms, sp } from '../motion';
import { hexA } from '../utils';
import { Appear, Tappable } from './anim';

// A task's completion box. With subtasks it fills up as they're ticked off,
// and the task only completes once all of them are: ticking it early shakes
// the box with a warning buzz and calls `onBlocked`, so the screen can show
// what's still open.
export function TaskCheck({
  color,
  done,
  subTotal,
  subLeft,
  size = 24,
  radius = 8,
  onToggle,
  onBlocked,
}: {
  color: string;
  done: boolean;
  subTotal: number;
  subLeft: number;
  size?: number;
  radius?: number;
  onToggle: () => void;
  onBlocked?: () => void;
}) {
  const shakeX = useSharedValue(0);
  const fill = useSharedValue(0);
  const progress = !done && subTotal ? (subTotal - subLeft) / subTotal : 0;
  useEffect(() => {
    fill.value = withSpring(progress, sp({ damping: 20, stiffness: 200 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  const press = () => {
    if (!done && subLeft > 0) {
      shakeX.value = withSequence(
        withTiming(-5, { duration: ms(45) }),
        withTiming(5, { duration: ms(70) }),
        withTiming(-4, { duration: ms(65) }),
        withTiming(3, { duration: ms(60) }),
        withTiming(0, { duration: ms(55) })
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      onBlocked?.();
      return;
    }
    if (done) Haptics.selectionAsync().catch(() => {});
    else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onToggle();
  };

  const inner = size - 6;
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shakeX.value }] }));
  const fillStyle = useAnimatedStyle(() => ({ height: inner * fill.value, opacity: fill.value > 0.01 ? 1 : 0 }));

  return (
    <Animated.View style={shakeStyle}>
      <Tappable
        onPress={press}
        hitSlop={8}
        scaleTo={0.82}
        style={[
          styles.box,
          { width: size, height: size, borderRadius: radius },
          { backgroundColor: done ? color : 'transparent', boxShadow: `inset 0 0 0 2px ${done ? color : hexA(color, 0.5)}` },
        ]}>
        {/* The subtask "level" (inset so the ring stays crisp). */}
        {subTotal > 0 && !done && (
          <Animated.View pointerEvents="none" style={[styles.fill, { borderRadius: Math.max(2, radius - 4), backgroundColor: hexA(color, 0.5) }, fillStyle]} />
        )}
        {done && (
          <Appear from="pop">
            <Feather name="check" size={Math.round(size * 0.6)} color="#0b0b0d" />
          </Appear>
        )}
      </Tappable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
  fill: { position: 'absolute', left: 3, right: 3, bottom: 3 },
});
