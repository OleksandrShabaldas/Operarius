import React, { useEffect } from 'react';
import { Pressable, PressableProps, StyleProp, StyleSheet, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Premium press feedback: a springy scale (+ subtle dim) on every tap. Drop-in
// replacement for Pressable for buttons, cards, chips, nav items, etc.
export function Tappable({
  children,
  style,
  onPress,
  onLongPress,
  disabled,
  hitSlop,
  scaleTo = 0.955,
  dimTo = 0.9,
  ...rest
}: {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  hitSlop?: PressableProps['hitSlop'];
  scaleTo?: number;
  dimTo?: number;
}) {
  const s = useSharedValue(1);
  const o = useSharedValue(1);
  // A static opacity in `style` (e.g. a dimmed/disabled control) is kept and
  // the press dim multiplies it — otherwise the animated opacity would win.
  const baseOpacity = (StyleSheet.flatten(style)?.opacity as number | undefined) ?? 1;
  const base = useSharedValue(baseOpacity);
  useEffect(() => {
    base.value = withTiming(baseOpacity, { duration: 180 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseOpacity]);
  const aStyle = useAnimatedStyle(() => ({ transform: [{ scale: s.value }], opacity: o.value * base.value }));
  return (
    <AnimatedPressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      hitSlop={hitSlop}
      onPressIn={() => {
        s.value = withSpring(scaleTo, { mass: 0.4, damping: 14, stiffness: 420 });
        o.value = withSpring(dimTo, { mass: 0.4, damping: 14, stiffness: 420 });
      }}
      onPressOut={() => {
        s.value = withSpring(1, { mass: 0.5, damping: 12, stiffness: 300 });
        o.value = withSpring(1, { mass: 0.5, damping: 12, stiffness: 300 });
      }}
      style={[style, aStyle]}
      {...rest}>
      {children}
    </AnimatedPressable>
  );
}

// Staggered entrance for a list item at `index` — each element animates in
// separately for a premium, cascading feel.
export function stagger(index: number, base = 24, step = 26) {
  return FadeInDown.springify()
    .damping(19)
    .stiffness(210)
    .delay(base + index * step)
    .withInitialValues({ transform: [{ translateY: 11 }], opacity: 0 });
}

export const EASE_OUT = Easing.out(Easing.cubic);

// Mount animation driven by a shared value rather than a layout `entering`
// animation, so it is safe INSIDE containers that themselves animate in
// (popups, sheets). `from` picks the motion; `delay` staggers siblings.
export function Appear({
  children,
  style,
  delay = 0,
  from = 'pop',
  distance = 12,
}: {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  delay?: number;
  from?: 'pop' | 'up' | 'down' | 'left' | 'right';
  distance?: number;
}) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(delay, withSpring(1, { damping: 17, stiffness: 230, mass: 0.7 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const a = useAnimatedStyle(() => {
    const o = Math.min(1, Math.max(0, p.value * 1.35));
    const k = 1 - p.value;
    if (from === 'pop') return { opacity: o, transform: [{ scale: 0.55 + 0.45 * p.value }] };
    if (from === 'up') return { opacity: o, transform: [{ translateY: k * distance }] };
    if (from === 'down') return { opacity: o, transform: [{ translateY: -k * distance }] };
    if (from === 'left') return { opacity: o, transform: [{ translateX: -k * distance }] };
    return { opacity: o, transform: [{ translateX: k * distance }] };
  });
  return <Animated.View style={[style, a]}>{children}</Animated.View>;
}
