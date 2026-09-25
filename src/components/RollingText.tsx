import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LayoutChangeEvent, StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import Animated, { Easing, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { ms } from '../motion';

// One character position. Rolls vertically from `from` to `to` (up when moving
// forward, down when moving back), like an odometer / split-flap. The slot is a
// clipped column holding both glyphs; its width eases from the old glyph's to
// the new one's as it rolls (a new slot grows in from nothing, a dropped one
// narrows away).
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
      ms(slot.delay),
      withTiming(1, { duration: ms(DURATION), easing: Easing.out(Easing.cubic) }, (f) => {
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
  // The width is driven here from the measured glyph, not by a layout
  // transition: those could leave a letter at a stale width (clipped, with a
  // gap after it) once the word around it had changed length.
  const w = useSharedValue(slot.from === '' ? 0 : -1); // -1: not measured yet (natural width)
  const delay = useRef(slot.delay);
  delay.current = slot.delay;
  const onMeasure = (e: LayoutChangeEvent) => {
    const target = e.nativeEvent.layout.width;
    if (w.value < 0) w.value = target;
    else w.value = withDelay(ms(delay.current), withTiming(target, { duration: ms(DURATION), easing: Easing.out(Easing.cubic) }));
  };
  const box = useAnimatedStyle(() => (w.value < 0 ? {} : { width: w.value }));
  return (
    <Animated.View style={[{ height, overflow: 'hidden', alignItems: 'center' }, box]}>
      {/* The incoming glyph, measured at its natural width (never squeezed by the slot). */}
      <View pointerEvents="none" style={styles.measure}>
        <Text style={glyph} onLayout={onMeasure}>
          {slot.to}
        </Text>
      </View>
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
    <View style={[{ flexDirection: 'row' }, style]}>
      {slots.map((s) => (
        <RollingChar key={s.id} slot={s} height={height} textStyle={textStyle} onDone={onDone} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  measure: { position: 'absolute', left: 0, top: 0, width: 400, flexDirection: 'row', opacity: 0 },
});
