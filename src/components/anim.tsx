import React from 'react';
import { Pressable, PressableProps, StyleProp, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
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
  const aStyle = useAnimatedStyle(() => ({ transform: [{ scale: s.value }], opacity: o.value }));
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
