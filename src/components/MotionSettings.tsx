import React, { useEffect, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { C } from '../theme';
import { sp, spW } from '../motion';
import { Tappable } from './anim';

// ---------------------------------------------------------------------------
// Toggle — a spring switch.
// ---------------------------------------------------------------------------
export function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const v = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    v.value = withSpring(value ? 1 : 0, sp({ damping: 17, stiffness: 260, mass: 0.7 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const track = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(v.value, [0, 1], ['rgba(255,255,255,0.12)', C.accentB]) }));
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: 3 + v.value * 20 }, { scale: 0.92 + 0.08 * v.value }] }));
  return (
    <Tappable onPress={() => onChange(!value)} scaleTo={0.92} hitSlop={8}>
      <Animated.View style={[styles.toggle, track]}>
        <Animated.View style={[styles.toggleThumb, thumb]} />
      </Animated.View>
    </Tappable>
  );
}

// ---------------------------------------------------------------------------
// ScaleSlider — 0.5× … 4× in fixed stops, evenly spaced (so the common range
// around 1× gets as much room as the slow end). Drag or tap; a haptic tick on
// every stop; commits on release.
// ---------------------------------------------------------------------------
export const SCALE_STOPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4];
const LABELED = new Set([0.5, 1, 2, 4]);
const THUMB = 28;

export const fmtScale = (s: number) => `${s % 1 === 0 ? s.toFixed(0) : String(s)}×`;

export function ScaleSlider({
  value,
  disabled,
  onPreview,
  onChange,
}: {
  value: number;
  disabled?: boolean;
  onPreview: (v: number) => void; // live, while dragging
  onChange: (v: number) => void; // on release
}) {
  const [w, setW] = useState(0);
  const n = SCALE_STOPS.length;
  const idxOf = (v: number) => {
    let best = 0;
    SCALE_STOPS.forEach((s, i) => {
      if (Math.abs(s - v) < Math.abs(SCALE_STOPS[best] - v)) best = i;
    });
    return best;
  };
  const [idx, setIdx] = useState(idxOf(value));
  useEffect(() => setIdx(idxOf(value)), [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const track = Math.max(0, w - THUMB);
  const step = n > 1 ? track / (n - 1) : 0;
  const x = useSharedValue(0);
  const lift = useSharedValue(0);
  useEffect(() => {
    if (w > 0) x.value = withSpring(idx * step, sp({ damping: 20, stiffness: 320 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, step]);

  const tick = (i: number) => {
    setIdx(i);
    onPreview(SCALE_STOPS[i]);
    Haptics.selectionAsync().catch(() => {});
  };
  const commit = (i: number) => onChange(SCALE_STOPS[i]);

  const lastIdx = useSharedValue(idx);
  const pan = Gesture.Pan()
    .enabled(!disabled)
    .minDistance(0)
    .onBegin((e) => {
      'worklet';
      lift.value = withSpring(1, spW({ damping: 16, stiffness: 300 }));
      const i = Math.max(0, Math.min(n - 1, Math.round((e.x - THUMB / 2) / (step || 1))));
      x.value = Math.max(0, Math.min(track, e.x - THUMB / 2));
      if (i !== lastIdx.value) {
        lastIdx.value = i;
        runOnJS(tick)(i);
      }
    })
    .onUpdate((e) => {
      'worklet';
      x.value = Math.max(0, Math.min(track, e.x - THUMB / 2));
      const i = Math.max(0, Math.min(n - 1, Math.round(x.value / (step || 1))));
      if (i !== lastIdx.value) {
        lastIdx.value = i;
        runOnJS(tick)(i);
      }
    })
    .onFinalize(() => {
      'worklet';
      lift.value = withSpring(0, spW({ damping: 16, stiffness: 300 }));
      x.value = withSpring(lastIdx.value * step, spW({ damping: 20, stiffness: 320 }));
      runOnJS(commit)(lastIdx.value);
    });

  const fill = useAnimatedStyle(() => ({ width: x.value + THUMB / 2 }));
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { scale: 1 + 0.12 * lift.value }] }));
  const bubble = useAnimatedStyle(() => ({ opacity: lift.value, transform: [{ translateX: x.value }, { translateY: (1 - lift.value) * 6 }, { scale: 0.8 + 0.2 * lift.value }] }));

  return (
    <View style={[styles.sliderWrap, disabled && { opacity: 0.4 }]} onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}>
      <GestureDetector gesture={pan}>
        <View style={styles.sliderHit}>
          <View style={styles.track}>
            <Animated.View style={[styles.fill, fill]}>
              <LinearGradient colors={[C.accentA, C.accentB]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
            </Animated.View>
          </View>
          {w > 0 &&
            SCALE_STOPS.map((s, i) => (
              <View key={s} pointerEvents="none" style={[styles.tick, { left: THUMB / 2 + i * step - 1.5 }, i <= idx && styles.tickOn]} />
            ))}
          <Animated.View pointerEvents="none" style={[styles.bubble, bubble]}>
            <Text style={styles.bubbleTxt}>{fmtScale(SCALE_STOPS[idx])}</Text>
          </Animated.View>
          <Animated.View pointerEvents="none" style={[styles.thumb, thumb]} />
        </View>
      </GestureDetector>
      <View style={styles.labels}>
        {w > 0 &&
          SCALE_STOPS.map((s, i) =>
            LABELED.has(s) ? (
              <Text key={s} style={[styles.label, { left: THUMB / 2 + i * step - 20 }, i === idx && styles.labelOn]}>
                {fmtScale(s)}
              </Text>
            ) : null
          )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// MotionPreview — a tiny task card that keeps gliding across and ticking its
// checkbox, timed exactly like the app at the chosen scale.
// ---------------------------------------------------------------------------
export function MotionPreview({ scale, enabled }: { scale: number; enabled: boolean }) {
  const [w, setW] = useState(0);
  const x = useSharedValue(0);
  const check = useSharedValue(0);
  const CARD = 132;

  useEffect(() => {
    cancelAnimation(x);
    cancelAnimation(check);
    x.value = 0;
    check.value = 0;
    if (!enabled || w === 0) return;
    const travel = Math.max(0, w - CARD - 24);
    const t = (v: number) => Math.round(v * scale);
    const k = scale === 1 ? { damping: 18, stiffness: 180 } : { damping: 18 / scale, stiffness: 180 / (scale * scale) };
    x.value = withRepeat(
      withSequence(withDelay(t(350), withSpring(travel, k)), withDelay(t(700), withSpring(0, k))),
      -1
    );
    check.value = withRepeat(
      withSequence(
        withDelay(t(900), withTiming(1, { duration: t(260), easing: Easing.out(Easing.back(2)) })),
        withDelay(t(650), withTiming(0, { duration: t(200) }))
      ),
      -1
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, enabled, w]);

  const card = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const box = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(check.value, [0, 1], ['rgba(79,209,197,0)', C.accentB]),
    transform: [{ scale: 0.85 + 0.15 * Math.min(1, check.value + 0.2) }],
  }));
  const mark = useAnimatedStyle(() => ({ opacity: check.value, transform: [{ scale: 0.5 + 0.5 * check.value }] }));

  return (
    <View style={styles.preview} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <Animated.View style={[styles.demoCard, card]}>
        <LinearGradient colors={['#7c7cf0', '#4fd1c5']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.demoIcon}>
          <Text style={styles.demoEmoji}>🏃</Text>
        </LinearGradient>
        <View style={{ flex: 1 }}>
          <View style={styles.demoLine} />
          <View style={[styles.demoLine, { width: '55%', opacity: 0.5 }]} />
        </View>
        <Animated.View style={[styles.demoCheck, box]}>
          <Animated.View style={mark}>
            <Feather name="check" size={11} color="#0b0b0d" />
          </Animated.View>
        </Animated.View>
      </Animated.View>
      {!enabled && (
        <View style={styles.offVeil}>
          <Feather name="pause-circle" size={15} color={C.muted} />
          <Text style={styles.offTxt}>Animations are off</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: { width: 50, height: 30, borderRadius: 15, justifyContent: 'center' },
  toggleThumb: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff', boxShadow: '0 2px 6px rgba(0,0,0,0.4)' },

  sliderWrap: { paddingTop: 30 },
  sliderHit: { height: 36, justifyContent: 'center' },
  track: { marginHorizontal: THUMB / 2, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  fill: { position: 'absolute', left: -THUMB / 2, top: 0, bottom: 0, overflow: 'hidden' },
  tick: { position: 'absolute', top: 15, width: 3, height: 6, borderRadius: 1.5, backgroundColor: 'rgba(255,255,255,0.18)' },
  tickOn: { backgroundColor: 'rgba(11,11,13,0.35)' },
  thumb: { position: 'absolute', left: 0, width: THUMB, height: THUMB, borderRadius: THUMB / 2, backgroundColor: '#f4f4f6', boxShadow: '0 4px 12px rgba(0,0,0,0.55), 0 0 0 4px rgba(79,209,197,0.18)' },
  bubble: { position: 'absolute', left: THUMB / 2 - 26, top: -30, width: 52, height: 26, borderRadius: 9, backgroundColor: C.accentB, alignItems: 'center', justifyContent: 'center' },
  bubbleTxt: { fontSize: 13, fontWeight: '800', color: '#0b0b0d', fontVariant: ['tabular-nums'] },
  labels: { height: 20, marginTop: 6 },
  label: { position: 'absolute', width: 40, textAlign: 'center', fontSize: 11.5, fontWeight: '700', color: C.muted, fontVariant: ['tabular-nums'] },
  labelOn: { color: C.accentB },

  preview: { height: 72, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.03)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)', justifyContent: 'center', paddingHorizontal: 12, overflow: 'hidden' },
  demoCard: { width: 132, height: 48, borderRadius: 13, backgroundColor: C.card, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, boxShadow: 'inset 0 0 0 1px rgba(124,124,240,0.25), 0 6px 16px -6px rgba(124,124,240,0.5)' },
  demoIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  demoEmoji: { fontSize: 14 },
  demoLine: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.22)', marginVertical: 3, width: '90%' },
  demoCheck: { width: 18, height: 18, borderRadius: 6, alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 0 0 0 1.5px rgba(79,209,197,0.8)' },
  offVeil: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(11,11,13,0.72)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  offTxt: { fontSize: 13, fontWeight: '700', color: C.muted },
});
