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
type Mode = 'days' | 'months' | 'years';
const SHORT = MONTHS.map((m) => m.slice(0, 3));
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
// tap a day to go there. Tap the month's name to pick a month, the year to
// pick a year.
export function MonthView({ open, top, selectedKey, weekStart, dotsFor, onPick, onClose }: Props) {
  const [mounted, setMounted] = useState(open);
  const [view, setView] = useState<YM>(ymOf(selectedKey));
  const [dir, setDir] = useState(1);
  const [mode, setMode] = useState<Mode>('days');
  const [yearPage, setYearPage] = useState(0); // first year shown by the year picker
  const [gridH, setGridH] = useState(0); // the day grid's height — the pickers take the same room
  const p = useSharedValue(0); // open progress
  const pickP = useSharedValue(0); // 1 while a month / year picker is up
  const dx = useSharedValue(0); // swipe offset
  const today = todayKey();
  const current = ymOf(today);

  useEffect(() => {
    if (open) {
      setView(ymOf(selectedKey));
      setMode('days');
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

  // Android back closes a picker first, then the panel.
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (mode !== 'days') setMode('days');
      else onClose();
      return true;
    });
    return () => sub.remove();
  }, [open, onClose, mode]);

  // The arrows (and swipes) step by what's shown: a month, a year, twelve years.
  const go = (delta: number) => {
    setDir(delta > 0 ? 1 : -1);
    if (mode === 'days') setView((v) => shiftYM(v, delta));
    else if (mode === 'months') setView((v) => ({ y: v.y + delta, m: v.m }));
    else setYearPage((p) => p + 12 * delta);
    Haptics.selectionAsync().catch(() => {});
  };
  useEffect(() => {
    pickP.value = withTiming(mode === 'days' ? 0 : 1, { duration: ms(200), easing: Easing.out(Easing.cubic) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
  const toggle = (m: Mode) => {
    Haptics.selectionAsync().catch(() => {});
    if (m === 'years') setYearPage(view.y - 4);
    setMode((cur) => (cur === m ? 'days' : m));
  };
  const pickMonth = (m: number) => {
    Haptics.selectionAsync().catch(() => {});
    setDir(m >= view.m ? 1 : -1);
    setView({ y: view.y, m });
    setMode('days');
  };
  const pickYear = (y: number) => {
    Haptics.selectionAsync().catch(() => {});
    setDir(y >= view.y ? 1 : -1);
    setView({ y, m: view.m });
    setMode('days');
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
  // The weekday letters make way for a picker (lifting away as it opens).
  const dow = useAnimatedStyle(() => ({ opacity: 1 - pickP.value, transform: [{ translateY: -5 * pickP.value }] }));

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
            <TitlePart text={MONTHS[view.m]} dir={dir} open={mode === 'months'} onPress={() => toggle('months')} />
            <TitlePart text={String(view.y)} dir={dir} open={mode === 'years'} onPress={() => toggle('years')} />
          </View>
          {offMonth && mode === 'days' && (
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

        <Animated.View style={[styles.dowRow, dow]}>
          {letters.map((l, i) => (
            <Text key={i} style={styles.dow}>
              {l}
            </Text>
          ))}
        </Animated.View>

        <GestureDetector gesture={swipe}>
          <Animated.View style={grid}>
            {mode === 'months' ? (
              <PickGrid
                key={`m${view.y}`}
                height={gridH}
                items={SHORT.map((label, m) => ({ label, on: m === view.m, now: view.y === current.y && m === current.m, onPress: () => pickMonth(m) }))}
              />
            ) : mode === 'years' ? (
              <PickGrid
                key={`y${yearPage}`}
                height={gridH}
                items={Array.from({ length: 12 }, (_, i) => yearPage + i).map((y) => ({ label: String(y), on: y === view.y, now: y === current.y, onPress: () => pickYear(y) }))}
              />
            ) : (
            <View key={`${view.y}-${view.m}`} onLayout={(e) => setGridH(e.nativeEvent.layout.height)}>
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
            )}
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

// The month's name / the year in the header: tap to open its picker.
function TitlePart({ text, dir, open, onPress }: { text: string; dir: number; open: boolean; onPress: () => void }) {
  const v = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    v.value = withSpring(open ? 1 : 0, sp({ damping: 16, stiffness: 260 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const chev = useAnimatedStyle(() => ({ transform: [{ rotate: `${v.value * 180}deg` }] }));
  const bg = useAnimatedStyle(() => ({ opacity: v.value }));
  return (
    <Tappable onPress={onPress} hitSlop={6} scaleTo={0.94} style={styles.titlePart}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.titleOn, bg]} />
      <RollingText text={text} dir={dir} height={24} textStyle={[styles.title, open && { color: C.accentB }]} />
      <Animated.View style={chev}>
        <Feather name="chevron-down" size={15} color={open ? C.accentB : C.muted} />
      </Animated.View>
    </Tappable>
  );
}

// Twelve choices (months, or years) in the room of the day grid.
function PickGrid({ items, height }: { items: { label: string; on: boolean; now: boolean; onPress: () => void }[]; height: number }) {
  return (
    <View style={[styles.pick, height > 0 && { height }]}>
      {Array.from({ length: 4 }, (_, r) => (
        <View key={r} style={styles.pickRow}>
          {items.slice(r * 3, r * 3 + 3).map((it, c) => (
            <Appear key={it.label} from="pop" delay={(r * 3 + c) * 18} style={styles.pickCellWrap}>
              <Tappable onPress={it.onPress} scaleTo={0.92} style={[styles.pickCell, it.now && !it.on && styles.pickNow]}>
                {it.on && <LinearGradient colors={['rgba(124,124,240,0.42)', 'rgba(79,209,197,0.2)']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={[StyleSheet.absoluteFill, styles.pickSel]} />}
                <Text style={[styles.pickTxt, it.now && { color: C.accentB }, it.on && { color: '#fff' }]}>{it.label}</Text>
              </Tappable>
            </Appear>
          ))}
        </View>
      ))}
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
  titleWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 },
  titlePart: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, height: 34, borderRadius: 10 },
  titleOn: { borderRadius: 10, backgroundColor: 'rgba(79,209,197,0.12)' },
  pick: { justifyContent: 'space-evenly', paddingVertical: 6 },
  pickRow: { flexDirection: 'row', gap: 8, marginVertical: 4 },
  pickCellWrap: { flex: 1 },
  pickCell: { height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.03)' },
  pickNow: { borderWidth: 1.5, borderColor: C.accentB },
  pickSel: { borderRadius: 14 },
  pickTxt: { fontSize: 16, fontWeight: '700', color: C.text, fontVariant: ['tabular-nums'] },
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
