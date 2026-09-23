import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { C, MONTHS } from '../theme';
import { WeekStart } from '../types';
import { dateKey, dateFromKey, todayKey, weekdayLetters } from '../utils';
import { ms, sp, spW } from '../motion';
import { Appear, Tappable } from './anim';
import { DayDot, Dots } from './WeekStrip';
import { RollingText } from './RollingText';

type Props = {
  open: boolean;
  top: number; // where the panel hangs from (just under the header's date row)
  selectedKey: string;
  weekStart: WeekStart;
  dotsFor: (key: string) => DayDot[];
  onPick: (key: string) => void;
  onClose: () => void;
};

type YM = { y: number; m: number };
const ymOf = (key: string): YM => {
  const d = dateFromKey(key);
  return { y: d.getFullYear(), m: d.getMonth() };
};
const shiftYM = ({ y, m }: YM, delta: number): YM => {
  const t = y * 12 + m + delta;
  return { y: Math.floor(t / 12), m: ((t % 12) + 12) % 12 };
};
const sameYM = (a: YM, b: YM) => a.y === b.y && a.m === b.m;

// The 6×7 days shown for a month (with the neighbouring months' days around it).
function monthCells({ y, m }: YM, weekStart: WeekStart): string[] {
  const first = new Date(y, m, 1);
  const lead = weekStart === 'mon' ? (first.getDay() + 6) % 7 : first.getDay();
  return Array.from({ length: 42 }, (_, i) => dateKey(new Date(y, m, 1 - lead + i)));
}

// A month drops down from under the header: every day with its task dots,
// today ringed, the open day filled. Swipe or use the arrows to change month;
// tap a day to go there.
export function MonthView({ open, top, selectedKey, weekStart, dotsFor, onPick, onClose }: Props) {
  const [mounted, setMounted] = useState(open);
  const [view, setView] = useState<YM>(ymOf(selectedKey));
  const [dir, setDir] = useState(1);
  const p = useSharedValue(0); // open progress
  const dx = useSharedValue(0); // swipe offset
  const today = todayKey();
  const current = ymOf(today);

  useEffect(() => {
    if (open) {
      setView(ymOf(selectedKey));
      setMounted(true);
      p.value = withSpring(1, sp({ damping: 22, stiffness: 240, mass: 0.8 }));
    } else if (mounted) {
      p.value = withTiming(0, { duration: ms(190), easing: Easing.in(Easing.cubic) }, (f) => {
        'worklet';
        if (f) runOnJS(setMounted)(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Android back closes the panel first.
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [open, onClose]);

  const go = (delta: number) => {
    setDir(delta > 0 ? 1 : -1);
    setView((v) => shiftYM(v, delta));
    Haptics.selectionAsync().catch(() => {});
  };
  const goRef = useRef(go);
  goRef.current = go;
  const swipeTo = (delta: number) => goRef.current(delta);

  const swipe = Gesture.Pan()
    .activeOffsetX([-14, 14])
    .failOffsetY([-14, 14])
    .onUpdate((e) => {
      'worklet';
      dx.value = e.translationX * 0.55;
    })
    .onEnd((e) => {
      'worklet';
      const delta = e.translationX < -50 || e.velocityX < -500 ? 1 : e.translationX > 50 || e.velocityX > 500 ? -1 : 0;
      if (delta !== 0) runOnJS(swipeTo)(delta);
      dx.value = withSpring(0, spW({ damping: 20, stiffness: 220 }));
    });

  const panel = useAnimatedStyle(() => ({
    opacity: Math.min(1, p.value * 1.4),
    transform: [{ translateY: (1 - p.value) * -18 }, { scaleY: 0.94 + 0.06 * p.value }],
  }));
  const shade = useAnimatedStyle(() => ({ opacity: p.value }));
  const grid = useAnimatedStyle(() => ({ transform: [{ translateX: dx.value }] }));

  const cells = useMemo(() => monthCells(view, weekStart), [view, weekStart]);
  const letters = weekdayLetters(weekStart);
  const offMonth = !sameYM(view, current);

  if (!mounted) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={open ? 'box-none' : 'none'}>
      <Animated.View style={[styles.shade, { top }, shade]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <Animated.View style={[styles.panel, { top }, panel]}>
        <View style={styles.nav}>
          <Tappable onPress={() => go(-1)} hitSlop={8} style={styles.navBtn}>
            <Feather name="chevron-left" size={20} color={C.textDim} />
          </Tappable>
          <View style={styles.titleWrap}>
            <RollingText text={`${MONTHS[view.m]} ${view.y}`} dir={dir} height={24} textStyle={styles.title} />
          </View>
          {offMonth && (
            <Appear from="pop" key={`${view.y}-${view.m}`}>
              <Tappable
                onPress={() => {
                  const back = view.y * 12 + view.m > current.y * 12 + current.m ? -1 : 1;
                  setDir(back);
                  setView(current);
                  Haptics.selectionAsync().catch(() => {});
                }}
                style={styles.thisMonth}
                hitSlop={6}>
                <Feather name="calendar" size={12} color={C.accentB} />
                <Text style={styles.thisMonthTxt}>This month</Text>
              </Tappable>
            </Appear>
          )}
          <Tappable onPress={() => go(1)} hitSlop={8} style={styles.navBtn}>
            <Feather name="chevron-right" size={20} color={C.textDim} />
          </Tappable>
        </View>

        <View style={styles.dowRow}>
          {letters.map((l, i) => (
            <Text key={i} style={styles.dow}>
              {l}
            </Text>
          ))}
        </View>

        <GestureDetector gesture={swipe}>
          <Animated.View style={grid}>
            <View key={`${view.y}-${view.m}`}>
              {Array.from({ length: 6 }, (_, r) => (
                <Appear key={r} from={dir > 0 ? 'right' : 'left'} distance={24} delay={r * 22} style={styles.week}>
                  {cells.slice(r * 7, r * 7 + 7).map((key) => {
                    const d = dateFromKey(key);
                    const inMonth = d.getMonth() === view.m;
                    const selected = key === selectedKey;
                    const isToday = key === today;
                    return (
                      <Tappable
                        key={key}
                        onPress={() => {
                          Haptics.selectionAsync().catch(() => {});
                          onPick(key);
                        }}
                        scaleTo={0.9}
                        style={[styles.cell, !inMonth && styles.cellOut]}>
                        {selected && (
                          <LinearGradient colors={['rgba(124,124,240,0.34)', 'rgba(79,209,197,0.16)']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={[StyleSheet.absoluteFill, styles.cellSel]} />
                        )}
                        <View style={[styles.num, isToday && !selected && styles.numToday]}>
                          <Text style={[styles.numTxt, isToday && styles.numTxtToday, selected && styles.numTxtSel]}>{d.getDate()}</Text>
                        </View>
                        <Dots dots={dotsFor(key)} width={34} height={11} />
                      </Tappable>
                    );
                  })}
                </Appear>
              ))}
            </View>
          </Animated.View>
        </GestureDetector>

        <View style={styles.grab}>
          <Tappable onPress={onClose} hitSlop={10} style={styles.grabBtn}>
            <Feather name="chevron-up" size={18} color={C.muted} />
          </Tappable>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  shade: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' },
  panel: {
    position: 'absolute',
    left: 10,
    right: 10,
    borderRadius: 24,
    backgroundColor: C.sheet,
    paddingHorizontal: 10,
    paddingTop: 12,
    boxShadow: '0 24px 60px -18px rgba(0,0,0,0.95), inset 0 0 0 1px rgba(255,255,255,0.07)',
    transformOrigin: 'top',
  },
  nav: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2, marginBottom: 10 },
  navBtn: { width: 36, height: 36, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
  titleWrap: { flex: 1, alignItems: 'center' },
  title: { fontSize: 17, fontWeight: '800', color: C.text },
  thisMonth: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, height: 30, borderRadius: 10, backgroundColor: 'rgba(79,209,197,0.13)' },
  thisMonthTxt: { fontSize: 12, fontWeight: '800', color: C.accentB },
  dowRow: { flexDirection: 'row', marginBottom: 4 },
  dow: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '700', color: C.muted },
  week: { flexDirection: 'row' },
  cell: { flex: 1, alignItems: 'center', paddingTop: 6, paddingBottom: 5, borderRadius: 14, overflow: 'hidden', gap: 3 },
  cellOut: { opacity: 0.32 },
  cellSel: { borderRadius: 14 },
  num: { width: 30, height: 26, borderRadius: 9, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'transparent' },
  numToday: { borderColor: C.accentB },
  numTxt: { fontSize: 15, fontWeight: '600', color: C.text, fontVariant: ['tabular-nums'] },
  numTxtToday: { color: C.accentB, fontWeight: '800' },
  numTxtSel: { color: '#fff', fontWeight: '800' },
  grab: { alignItems: 'center', paddingVertical: 6 },
  grabBtn: { width: 44, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
