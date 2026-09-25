import React, { useMemo, useState } from 'react';
import { LayoutChangeEvent, PixelRatio, Platform, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { C } from '../theme';
import { hexA } from '../utils';

// Diagonal repeating-stripe fill — bands 9 wide every 18 (measured across
// them), rising to the right — reproducing the prototype's repeating
// linear gradient, with the pattern feathered out on all four edges so it
// blends into the background.
//
// On the phone the stripes are a small gradient tile the view repeats as its
// background, drawn by the GPU and scaling to any size for free. (An SVG
// pattern was rasterised in software on every mount and resize: a long day's
// bands and free blocks took seconds to draw.) Web keeps the SVG.

// The tile: a square holding two bands (its diagonal is two periods, 36),
// sized to whole pixels so neighbouring tiles meet without a seam.
const TILE = (() => {
  const r = PixelRatio.get();
  return Math.round((36 / Math.SQRT2) * r) / r;
})();

// Across the tile's diagonal: bands centred on the corners and the middle, with
// ~1px soft edges so the diagonals don't stair-step. (The clear stops are the
// same colour at 0 alpha, so the edges don't darken toward black.)
function stripes(color: string, opacity: number) {
  const on = hexA(color, opacity);
  const off = hexA(color, 0);
  return `linear-gradient(135deg, ${on} 0%, ${on} 11.9%, ${off} 13.1%, ${off} 36.9%, ${on} 38.1%, ${on} 61.9%, ${off} 63.1%, ${off} 86.9%, ${on} 88.1%, ${on} 100%)`;
}

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
  const bg = useMemo(
    () => ({ experimental_backgroundImage: stripes(color, opacity), experimental_backgroundSize: `${TILE}px ${TILE}px`, borderRadius: radius }) as ViewStyle,
    [color, opacity, radius]
  );
  const clear = fade + '00'; // works for #rrggbb → #rrggbb00 (transparent)
  const sideFades = fadeSides === 'all';
  return (
    <View style={[styles.wrap, { borderRadius: radius }, style]}>
      {Platform.OS === 'web' ? <WebPattern color={color} opacity={opacity} /> : <View pointerEvents="none" style={[StyleSheet.absoluteFill, bg]} />}

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

let counter = 0;

// The web preview: an SVG pattern sized from the measured layout.
function WebPattern({ color, opacity }: { color: string; opacity: number }) {
  const id = useMemo(() => `hatch${counter++}`, []);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((s) => (s && Math.abs(s.w - width) < 0.5 && Math.abs(s.h - height) < 0.5 ? s : { w: width, h: height }));
  };
  return (
    <View pointerEvents="none" onLayout={onLayout} style={StyleSheet.absoluteFill}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  edge: { position: 'absolute', pointerEvents: 'none' },
});
