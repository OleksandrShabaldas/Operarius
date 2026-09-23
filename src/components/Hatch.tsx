import React, { useState } from 'react';
import { LayoutChangeEvent, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { C } from '../theme';

let counter = 0;

// Diagonal repeating-stripe fill, reproducing the prototype's
// repeating-linear-gradient(45deg, color 0 9px, transparent 9px 18px), with the
// pattern feathered out on all four edges so it blends into the background.
// The SVG is sized from the measured layout (not "100%") so it always redraws
// at the container's current size — e.g. when a free block grows after a task
// is moved, the stripes fill the whole block instead of its old height.
export function Hatch({
  color,
  opacity = 1,
  radius = 13,
  fade = C.bg,
  fadeSize = 26,
  fadeSides = 'all',
  style,
  children,
}: {
  color: string;
  opacity?: number;
  radius?: number;
  fade?: string; // color the edges dissolve into
  fadeSize?: number;
  fadeSides?: 'all' | 'y'; // 'y' fades only top/bottom (for edge-to-edge bands)
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  const id = React.useMemo(() => `hatch${counter++}`, []);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((s) => (s && Math.abs(s.w - width) < 0.5 && Math.abs(s.h - height) < 0.5 ? s : { w: width, h: height }));
  };
  const clear = fade + '00'; // works for #rrggbb → #rrggbb00 (transparent)
  const sideFades = fadeSides === 'all';
  return (
    <View onLayout={onLayout} style={[styles.wrap, { borderRadius: radius }, style]}>
      {size && size.w > 0 && size.h > 0 && (
        <Svg style={StyleSheet.absoluteFill} width={size.w} height={size.h}>
          <Defs>
            <Pattern id={id} width={18} height={18} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <Rect width={9} height={18} fill={color} opacity={opacity} />
            </Pattern>
          </Defs>
          <Rect width={size.w} height={size.h} fill={`url(#${id})`} />
        </Svg>
      )}

      {/* Edge feathering (corners double up for a soft all-around fade). */}
      <LinearGradient colors={[fade, clear]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={[styles.edge, { top: 0, left: 0, right: 0, height: fadeSize }]} />
      <LinearGradient colors={[clear, fade]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={[styles.edge, { bottom: 0, left: 0, right: 0, height: fadeSize }]} />
      {sideFades && (
        <>
          <LinearGradient colors={[fade, clear]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.edge, { top: 0, bottom: 0, left: 0, width: fadeSize }]} />
          <LinearGradient colors={[clear, fade]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.edge, { top: 0, bottom: 0, right: 0, width: fadeSize }]} />
        </>
      )}

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  edge: { position: 'absolute', pointerEvents: 'none' },
});
