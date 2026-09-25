import React, { useMemo, useState } from 'react';
import { LayoutChangeEvent, PixelRatio, Platform, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Svg, { Defs, G, Line, LinearGradient, Mask, RadialGradient, Rect, Stop } from 'react-native-svg';
import { LinearGradient as Fade } from 'expo-linear-gradient';
import { hexA } from '../utils';

let seq = 0;

type Radial = 'radial' | 'radial-soft' | 'radial-faint';
export type StripeFade = Radial | { top?: number; bottom?: number; left?: number; right?: number };

// Opacity stops (offset → alpha) for the radial fades. "soft" keeps a gentle
// plateau around the centre and then eases out over a long tail, so a halo
// dissolves gradually instead of ending in a visible ring; "faint" starts
// lower and eases out even longer — barely there at the edges.
const RADIAL: Record<Radial, [number, number][]> = {
  radial: [
    [0, 1],
    [0.55, 0.55],
    [1, 0],
  ],
  'radial-soft': [
    [0, 1],
    [0.42, 0.7],
    [0.66, 0.26],
    [0.84, 0.07],
    [1, 0],
  ],
  'radial-faint': [
    [0, 0.85],
    [0.22, 0.6],
    [0.44, 0.3],
    [0.62, 0.12],
    [0.78, 0.035],
    [0.9, 0.008],
    [1, 0],
  ],
};

type Props = {
  color: string;
  opacity?: number;
  spacing?: number;
  strokeWidth?: number;
  fade?: StripeFade;
  // The flat colour right behind the stripes: their edges fade into it.
  fadeTo?: string;
  style?: StyleProp<ViewStyle>;
};

// Thin diagonal stripes, rising to the right, `spacing` apart (measured across
// the view), fading out at the edges.
//
// On the phone they're drawn by the GPU: a small gradient tile the view
// repeats as its background, with the edges faded by gradients in `fadeTo`,
// the flat colour behind them (over a flat colour that is the same as fading
// the stripes themselves). An SVG with alpha masks was painted in software
// and held the day up for most of a second each time it came on screen. The
// web preview, and radial fades, keep the SVG.
export function Stripes(props: Props) {
  const edges = props.fade && typeof props.fade === 'object' ? props.fade : null;
  if (Platform.OS === 'web' || !props.fadeTo || (props.fade && !edges)) return <SvgStripes {...props} />;
  return <TileStripes {...props} edges={edges} fadeTo={props.fadeTo} />;
}

function TileStripes({
  color,
  opacity = 0.5,
  spacing = 6,
  strokeWidth = 1,
  edges,
  fadeTo,
  style,
}: Props & { edges: { top?: number; bottom?: number; left?: number; right?: number } | null; fadeTo: string }) {
  const bg = useMemo(() => {
    // One period across the tile's diagonal: a line through its corners and one
    // through its middle, so tiles meet seamlessly. Whole pixels, no seams.
    const r = PixelRatio.get();
    const tile = Math.max(1, Math.round(spacing * r)) / r;
    const diag = tile * Math.SQRT2;
    const half = (strokeWidth / 2 / diag) * 100;
    const soft = (0.45 / diag) * 50; // half of a ~0.45 soft edge, so lines don't stair-step
    const on = hexA(color, opacity);
    const off = hexA(color, 0);
    const p = (v: number) => `${Math.max(0, Math.min(100, v)).toFixed(2)}%`;
    const img =
      `linear-gradient(135deg, ${on} 0%, ${on} ${p(half - soft)}, ${off} ${p(half + soft)}, ` +
      `${off} ${p(50 - half - soft)}, ${on} ${p(50 - half + soft)}, ${on} ${p(50 + half - soft)}, ${off} ${p(50 + half + soft)}, ` +
      `${off} ${p(100 - half - soft)}, ${on} ${p(100 - half + soft)}, ${on} 100%)`;
    return { experimental_backgroundImage: img, experimental_backgroundSize: `${tile}px ${tile}px` } as ViewStyle;
  }, [color, opacity, spacing, strokeWidth]);
  const clear = hexA(fadeTo, 0);
  const t = edges?.top ?? 0;
  const b = edges?.bottom ?? 0;
  const l = edges?.left ?? 0;
  const rt = edges?.right ?? 0;
  return (
    <View pointerEvents="none" style={[styles.wrap, style]}>
      <View style={[StyleSheet.absoluteFill, bg]} />
      {t > 0 && <Fade colors={[fadeTo, clear]} style={[styles.edge, { top: 0, left: 0, right: 0, height: t }]} />}
      {b > 0 && <Fade colors={[clear, fadeTo]} style={[styles.edge, { bottom: 0, left: 0, right: 0, height: b }]} />}
      {l > 0 && <Fade colors={[fadeTo, clear]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.edge, { top: 0, bottom: 0, left: 0, width: l }]} />}
      {rt > 0 && <Fade colors={[clear, fadeTo]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.edge, { top: 0, bottom: 0, right: 0, width: rt }]} />}
    </View>
  );
}

// The SVG version: stripes faded through an alpha mask, so they dissolve into
// whatever sits behind them. Sizes itself from layout and redraws on resize.
function SvgStripes({
  color,
  opacity = 0.5,
  spacing = 6,
  strokeWidth = 1,
  fade,
  style,
}: {
  color: string;
  opacity?: number;
  spacing?: number;
  strokeWidth?: number;
  fade?: StripeFade;
  fadeTo?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const id = useMemo(() => `stp${seq++}`, []);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((s) => (s && Math.abs(s.w - width) < 0.5 && Math.abs(s.h - height) < 0.5 ? s : { w: width, h: height }));
  };

  let body: React.ReactNode = null;
  if (size && size.w > 0 && size.h > 0) {
    const { w, h } = size;
    const lines: React.ReactNode[] = [];
    for (let x = -h; x < w + h; x += spacing) {
      lines.push(<Line key={x} x1={x} y1={h} x2={x + h} y2={0} stroke={color} strokeWidth={strokeWidth} strokeOpacity={opacity} />);
    }
    const radial = fade === 'radial' || fade === 'radial-soft' || fade === 'radial-faint' ? fade : null;
    const edges = fade && !radial && typeof fade === 'object' ? fade : null;
    const t = edges?.top ?? 0;
    const b = edges?.bottom ?? 0;
    const l = edges?.left ?? 0;
    const r = edges?.right ?? 0;
    body = (
      <Svg width={w} height={h}>
        <Defs>
          {radial && (
            <RadialGradient id={`${id}g`} cx="50%" cy="50%" r="50%">
              {RADIAL[radial].map(([o, a]) => (
                <Stop key={o} offset={o} stopColor="#fff" stopOpacity={a} />
              ))}
            </RadialGradient>
          )}
          {edges && (
            <>
              <LinearGradient id={`${id}v`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#fff" stopOpacity={t ? 0 : 1} />
                <Stop offset={Math.min(0.5, t / h)} stopColor="#fff" stopOpacity={1} />
                <Stop offset={Math.max(0.5, 1 - b / h)} stopColor="#fff" stopOpacity={1} />
                <Stop offset="1" stopColor="#fff" stopOpacity={b ? 0 : 1} />
              </LinearGradient>
              <LinearGradient id={`${id}h`} x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor="#fff" stopOpacity={l ? 0 : 1} />
                <Stop offset={Math.min(0.5, l / w)} stopColor="#fff" stopOpacity={1} />
                <Stop offset={Math.max(0.5, 1 - r / w)} stopColor="#fff" stopOpacity={1} />
                <Stop offset="1" stopColor="#fff" stopOpacity={r ? 0 : 1} />
              </LinearGradient>
            </>
          )}
          {radial && (
            <Mask id={`${id}m`} maskUnits="userSpaceOnUse" x="0" y="0" width={w} height={h}>
              <Rect x="0" y="0" width={w} height={h} fill={`url(#${id}g)`} />
            </Mask>
          )}
          {edges && (
            <>
              <Mask id={`${id}mv`} maskUnits="userSpaceOnUse" x="0" y="0" width={w} height={h}>
                <Rect x="0" y="0" width={w} height={h} fill={`url(#${id}v)`} />
              </Mask>
              <Mask id={`${id}mh`} maskUnits="userSpaceOnUse" x="0" y="0" width={w} height={h}>
                <Rect x="0" y="0" width={w} height={h} fill={`url(#${id}h)`} />
              </Mask>
            </>
          )}
        </Defs>
        {radial ? (
          <G mask={`url(#${id}m)`}>{lines}</G>
        ) : edges ? (
          <G mask={`url(#${id}mv)`}>
            <G mask={`url(#${id}mh)`}>{lines}</G>
          </G>
        ) : (
          lines
        )}
      </Svg>
    );
  }

  return (
    <View pointerEvents="none" onLayout={onLayout} style={style}>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden' },
  edge: { position: 'absolute' },
});
