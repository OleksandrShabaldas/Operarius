import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleProp, Text, TextStyle, ViewStyle } from 'react-native';
import Animated, { Easing, interpolate, LinearTransition, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

// One character position. Rolls vertically from `from` to `to` (up when moving
// forward, down when moving back), like an odometer / split-flap. The slot is a
// clipped column holding both glyphs, so its width is the wider of the two while
// rolling; when it settles, a layout transition eases it to the new width.
type Slot = { id: number; from: string; to: string; dir: number; ver: number; delay: number };

let slotSeq = 0;
const DURATION = 300;

type GlyphStyle = StyleProp<TextStyle>;

// One roll: a fresh column per change (keyed by `ver`), so its first frame is
// always the outgoing glyph — never a flash of the target.
function RollColumn({ slot, height, glyph, onDone }: { slot: Slot; height: number; glyph: GlyphStyle; onDone: (id: number, ver: number) => void }) {
  const p = useSharedValue(0);
  const dir = slot.dir;
  // Space between the outgoing and incoming glyph, so descenders/ascenders of
  // the hidden one never peek into the clip window.
  const step = Math.round(height * 1.35);
  useEffect(() => {
    const { id, ver } = slot;
    p.value = withDelay(
      slot.delay,
      withTiming(1, { duration: DURATION, easing: Easing.out(Easing.cubic) }, (f) => {
        'worklet';
        if (f) runOnJS(onDone)(id, ver);
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const col = useAnimatedStyle(() => ({
    transform: [{ translateY: dir > 0 ? interpolate(p.value, [0, 1], [0, -step]) : interpolate(p.value, [0, 1], [-step, 0]) }],
  }));
  const first = dir > 0 ? slot.from : slot.to;
  const second = dir > 0 ? slot.to : slot.from;
  return (
    <Animated.View style={col}>
      <Text style={glyph}>{first}</Text>
      <Text style={[glyph, { marginTop: step - height }]}>{second}</Text>
    </Animated.View>
  );
}

function RollingChar({ slot, height, textStyle, onDone }: { slot: Slot; height: number; textStyle: GlyphStyle; onDone: (id: number, ver: number) => void }) {
  const glyph = [textStyle, { height, lineHeight: height, textAlign: 'center' as const, includeFontPadding: false }];
  return (
    <Animated.View layout={LinearTransition.duration(260)} style={{ height, overflow: 'hidden' }}>
      {slot.from === slot.to ? (
        // Settled: a single plain glyph (nothing hidden to bleed, and screen
        // readers read the text once).
        <Text style={glyph}>{slot.to}</Text>
      ) : (
        <RollColumn key={slot.ver} slot={slot} height={height} glyph={glyph} onDone={onDone} />
      )}
    </Animated.View>
  );
}

// A text whose characters each roll independently into the new text. Numbers
// align to the right (so 9 → 10 grows a tens digit and the units roll), words
// to the left; unchanged characters stay still.
export function RollingText({
  text,
  dir,
  height,
  textStyle,
  style,
  align = 'left',
  stagger = 24,
}: {
  text: string;
  dir: number; // +1 forward (roll up), -1 back (roll down)
  height: number;
  textStyle: StyleProp<TextStyle>;
  style?: StyleProp<ViewStyle>;
  align?: 'left' | 'right';
  stagger?: number;
}) {
  const [slots, setSlots] = useState<Slot[]>(() => Array.from(text).map((c) => ({ id: slotSeq++, from: c, to: c, dir: 1, ver: 0, delay: 0 })));
  const shown = useRef(text);

  useEffect(() => {
    if (text === shown.current) return;
    shown.current = text;
    setSlots((prev) => {
      const live = prev.filter((s) => s.to !== '');
      const oldChars = live.map((s) => s.to);
      const newChars = Array.from(text);
      const L = Math.max(oldChars.length, newChars.length);
      const padL = (a: string[]) => [...Array(L - a.length).fill(''), ...a];
      const padR = (a: string[]) => [...a, ...Array(L - a.length).fill('')];
      const from = align === 'right' ? padL(oldChars) : padR(oldChars);
      const to = align === 'right' ? padL(newChars) : padR(newChars);
      const reuse = align === 'right' ? [...Array(L - live.length).fill(null), ...live] : [...live, ...Array(L - live.length).fill(null)];
      return to.map((ch, i) => {
        const old = reuse[i] as Slot | null;
        const changed = from[i] !== ch;
        const order = align === 'right' ? L - 1 - i : i;
        return {
          id: old ? old.id : slotSeq++,
          from: from[i],
          to: ch,
          dir,
          ver: (old ? old.ver : 0) + (changed ? 1 : 0),
          delay: order * stagger,
        };
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  // After a slot finishes rolling, collapse it to the new glyph only (so its
  // width eases to the new character), and drop slots that rolled to nothing.
  const onDone = useCallback((id: number, ver: number) => {
    setSlots((prev) => prev.filter((s) => !(s.id === id && s.ver === ver && s.to === '')).map((s) => (s.id === id && s.ver === ver ? { ...s, from: s.to } : s)));
  }, []);

  return (
    <Animated.View layout={LinearTransition.duration(260)} style={[{ flexDirection: 'row' }, style]}>
      {slots.map((s) => (
        <RollingChar key={s.id} slot={s} height={height} textStyle={textStyle} onDone={onDone} />
      ))}
    </Animated.View>
  );
}
