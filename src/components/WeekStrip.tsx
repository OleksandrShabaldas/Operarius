import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { C } from '../theme';
import { WeekStart } from '../types';
import { addDays, dateFromKey, todayKey, weekdayLetters, weekOf } from '../utils';

// One dot per task on that day, in the task's colour: filled when completed,
// hollow when not.
export type DayDot = { color: string; done: boolean };

type Props = {
  selectedKey: string;
  weekStart: WeekStart;
  dotsFor: (key: string) => DayDot[];
  onSelect: (key: string) => void;
  onPageWeek: (delta: number) => void;
};

const WEEKS = 520; // ±10 years of pages
const DOT = 5;
const DOT_GAP = 3;
const PER_ROW = 4;
const MAX_DOTS = 8;
const DOTS_W = PER_ROW * DOT + (PER_ROW - 1) * DOT_GAP;
const DOTS_H = 2 * DOT + DOT_GAP;

function Dots({ dots }: { dots: DayDot[] }) {
  if (dots.length === 0) return <View style={{ width: DOTS_W, height: DOTS_H }} />;
  const overflow = dots.length > MAX_DOTS;
  const shown = overflow ? dots.slice(0, MAX_DOTS - 1) : dots;
  const count = shown.length + (overflow ? 1 : 0);
  const rows = Math.ceil(count / PER_ROW);
  const y0 = rows === 1 ? (DOTS_H - DOT) / 2 : 0;
  const pos = (i: number) => {
    const r = Math.floor(i / PER_ROW);
    const c = i % PER_ROW;
    const inRow = Math.min(PER_ROW, count - r * PER_ROW);
    const rowW = inRow * DOT + (inRow - 1) * DOT_GAP;
    return { cx: (DOTS_W - rowW) / 2 + c * (DOT + DOT_GAP) + DOT / 2, cy: y0 + r * (DOT + DOT_GAP) + DOT / 2 };
  };
  return (
    <Svg width={DOTS_W} height={DOTS_H}>
      {shown.map((d, i) => {
        const { cx, cy } = pos(i);
        return d.done ? (
          <Circle key={i} cx={cx} cy={cy} r={DOT / 2} fill={d.color} />
        ) : (
          <Circle key={i} cx={cx} cy={cy} r={DOT / 2 - 0.65} fill="none" stroke={d.color} strokeWidth={1.3} />
        );
      })}
      {overflow &&
        (() => {
          const { cx, cy } = pos(shown.length);
          return (
            <>
              <Line x1={cx - 2.2} y1={cy} x2={cx + 2.2} y2={cy} stroke={C.muted} strokeWidth={1.3} />
              <Line x1={cx} y1={cy - 2.2} x2={cx} y2={cy + 2.2} stroke={C.muted} strokeWidth={1.3} />
            </>
          );
        })()}
    </Svg>
  );
}

const daysBetween = (a: string, b: string) => Math.round((dateFromKey(b).getTime() - dateFromKey(a).getTime()) / 86400000);

// A native horizontal pager of weeks: the strip itself follows the finger and
// snaps to the neighbouring week (only the strip moves — not the whole screen).
export function WeekStrip({ selectedKey, weekStart, dotsFor, onSelect, onPageWeek }: Props) {
  const [w, setW] = useState(0);
  const letters = weekdayLetters(weekStart);
  const today = todayKey();
  const anchor = useMemo(() => weekOf(todayKey(), weekStart)[0], [weekStart]);
  const data = useMemo(() => Array.from({ length: 2 * WEEKS + 1 }, (_, i) => i), []);
  const index = WEEKS + Math.round(daysBetween(anchor, weekOf(selectedKey, weekStart)[0]) / 7);

  const listRef = useRef<FlatList<number>>(null);
  const shownIndex = useRef(index);

  // Follow selection changes that come from elsewhere (day swipe, Today button).
  useEffect(() => {
    if (!w) return;
    if (index !== shownIndex.current) {
      shownIndex.current = index;
      listRef.current?.scrollToIndex({ index, animated: true });
    }
  }, [index, w]);

  const settle = (x: number) => {
    if (!w) return;
    const i = Math.round(x / w);
    if (i !== shownIndex.current) {
      const delta = i - shownIndex.current;
      shownIndex.current = i;
      onPageWeek(delta);
    }
  };
  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => settle(e.nativeEvent.contentOffset.x);
  // react-native-web never emits momentum events: settle once scrolling has
  // been quiet for a moment (CSS scroll-snap has landed on a page by then).
  const quiet = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onScrollWeb = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    if (quiet.current) clearTimeout(quiet.current);
    quiet.current = setTimeout(() => settle(x), 160);
  };
  useEffect(() => () => {
    if (quiet.current) clearTimeout(quiet.current);
  }, []);

  const renderWeek = ({ item }: { item: number }) => {
    const start = addDays(anchor, (item - WEEKS) * 7);
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    return (
      <View style={[styles.row, { width: w }]}>
        {days.map((key, i) => {
          const selected = key === selectedKey;
          const isToday = key === today;
          return (
            <Pressable key={key} onPress={() => onSelect(key)} style={[styles.cell, selected && styles.cellSelected]}>
              {selected && (
                <LinearGradient colors={['rgba(124,124,240,0.28)', 'rgba(79,209,197,0.14)']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />
              )}
              <Text style={[styles.dow, { color: selected ? '#fff' : C.muted }]}>{letters[i]}</Text>
              <Text style={[styles.num, { color: selected ? '#fff' : isToday ? C.accentB : C.text }]}>{dateFromKey(key).getDate()}</Text>
              <View style={styles.dotsWrap}>
                <Dots dots={dotsFor(key)} />
              </View>
            </Pressable>
          );
        })}
      </View>
    );
  };

  return (
    <View style={styles.wrap} onLayout={(e) => setW(Math.round(e.nativeEvent.layout.width))}>
      {w > 0 && (
        <FlatList
          key={weekStart}
          ref={listRef}
          horizontal
          pagingEnabled
          data={data}
          keyExtractor={(i) => String(i)}
          renderItem={renderWeek}
          extraData={[selectedKey, dotsFor, w]}
          getItemLayout={(_, i) => ({ length: w, offset: w * i, index: i })}
          initialScrollIndex={index}
          onMomentumScrollEnd={onMomentumEnd}
          onScroll={Platform.OS === 'web' ? onScrollWeb : undefined}
          scrollEventThrottle={Platform.OS === 'web' ? 32 : undefined}
          showsHorizontalScrollIndicator={false}
          initialNumToRender={3}
          maxToRenderPerBatch={3}
          windowSize={3}
          decelerationRate="fast"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 14 },
  row: { flexDirection: 'row', gap: 4 },
  cell: { flex: 1, alignItems: 'center', paddingTop: 8, paddingBottom: 7, borderRadius: 14, overflow: 'hidden', position: 'relative' },
  cellSelected: { boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08), 0 6px 18px -8px rgba(124,124,240,0.6)' },
  dow: { fontSize: 11, fontWeight: '600', opacity: 0.6 },
  num: { fontSize: 16, fontWeight: '600', marginTop: 3 },
  dotsWrap: { marginTop: 5 },
});
