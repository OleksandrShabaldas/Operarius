import React, { useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleProp, View, ViewStyle } from 'react-native';
import Svg, { Defs, G, Line, LinearGradient, Mask, RadialGradient, Rect, Stop } from 'react-native-svg';

let seq = 0;

export type StripeFade = 'radial' | 'radial-soft' | { top?: number; bottom?: number; left?: number; right?: number };

// Opacity stops (offset → alpha) for the radial fades. "soft" keeps a gentle
// plateau around the centre and then eases out over a long tail, so a halo
// dissolves gradually instead of ending in a visible ring.
const RADIAL: Record<'radial' | 'radial-soft', [number, number][]> = {
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
};

// Thin diagonal stripes that fade out through an alpha mask, so they dissolve
// into whatever sits behind them (cards, bands, any colour) instead of fading to
// a fixed background colour. Sizes itself from layout and redraws on resize.
export function Stripes({
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
    const radial = fade === 'radial' || fade === 'radial-soft' ? fade : null;
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
