import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, NativeScrollEvent, NativeSyntheticEvent, PixelRatio, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
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

// Up to 12 dots: one row of up to 6, then two balanced rows. The busier the
// day, the smaller and tighter the dots, so a full day stays a compact cluster.
// More than 12 tasks → 11 dots and a "+".
const MAX_DOTS = 12;
const PER_ROW = 6;
const DOTS_W = 38;
const DOTS_H = 12;
const DOT_SIZE = [5, 5, 5, 5, 5, 4.6, 4.2]; // by dots in the widest row
const DOT_GAP = [0, 0, 4, 3.4, 2.8, 2.2, 1.7];

// Drawn as plain views (by the GPU), not an SVG: an SVG is painted in software
// whenever it mounts or changes, and a week strip holds some twenty of these.
// A day's dots are only redrawn when they change.
const sameDots = (a: DayDot[], b: DayDot[]) => a.length === b.length && a.every((d, i) => d.color === b[i].color && d.done === b[i].done);

export const Dots = React.memo(
  DotsBase,
  (p, n) => p.width === n.width && p.height === n.height && sameDots(p.dots, n.dots)
);

function DotsBase({ dots, width = DOTS_W, height = DOTS_H }: { dots: DayDot[]; width?: number; height?: number }) {
  if (dots.length === 0) return <View style={{ width, height }} />;
  const overflow = dots.length > MAX_DOTS;
  const shown = overflow ? dots.slice(0, MAX_DOTS - 1) : dots;
  const count = shown.length + (overflow ? 1 : 0);
  const rows = count > PER_ROW ? 2 : 1;
  const perRow = Math.ceil(count / rows);
  const size = DOT_SIZE[perRow];
  const gap = DOT_GAP[perRow];
  const rowGap = 2.2;
  const pos = (i: number) => {
    const r = Math.floor(i / perRow);
    const c = i % perRow;
    const inRow = r === 0 ? Math.min(perRow, count) : count - perRow;
    const rowW = inRow * size + (inRow - 1) * gap;
    const cy = rows === 1 ? height / 2 : height / 2 + (r === 0 ? -1 : 1) * ((size + rowGap) / 2);
    return { cx: (width - rowW) / 2 + c * (size + gap) + size / 2, cy };
  };
  const stroke = size < 4.8 ? 1.15 : 1.3;
  const box = (cx: number, cy: number, s: number) => ({ left: cx - s / 2, top: cy - s / 2, width: s, height: s, borderRadius: s / 2 });
  return (
    <View style={{ width, height }}>
      {shown.map((d, i) => {
        const { cx, cy } = pos(i);
        return <View key={i} style={[styles.dot, box(cx, cy, size), d.done ? { backgroundColor: d.color } : { borderWidth: stroke, borderColor: d.color }]} />;
      })}
      {overflow &&
        (() => {
          // "+": two rounded bars
          const { cx, cy } = pos(shown.length);
          const a = size - 0.4;
          return (
            <>
              <View style={[styles.plus, { left: cx - a / 2, top: cy - 0.6, width: a, height: 1.2 }]} />
              <View style={[styles.plus, { left: cx - 0.6, top: cy - a / 2, width: 1.2, height: a }]} />
            </>
          );
        })()}
    </View>
  );
}

const daysBetween = (a: string, b: string) => Math.round((dateFromKey(b).getTime() - dateFromKey(a).getTime()) / 86400000);

// A page width that is a whole number of physical pixels. The pager snaps in
// steps of its own width in pixels while the weeks are laid out in dp; any
// fraction of a pixel between the two adds up page after page (hundreds of
// weeks from the first one), leaving a swiped-to week cropped on one side and
// its neighbour peeking in on the other.
const pixelWidth = (dp: number) => {
  const r = PixelRatio.get();
  return Math.floor(dp * r) / r;
};

// A native horizontal pager of weeks: the strip itself follows the finger and
// snaps to the neighbouring week (only the strip moves — not the whole screen).
// Memoized: the Today screen re-renders on every drag step, the strip needn't.
export const WeekStrip = React.memo(function WeekStrip({ selectedKey, weekStart, dotsFor, onSelect, onPageWeek }: Props) {
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

  const extra = useMemo(() => [selectedKey, dotsFor, w, onSelect], [selectedKey, dotsFor, w, onSelect]);

  const renderWeek = ({ item }: { item: number }) => {
    const start = addDays(anchor, (item - WEEKS) * 7);
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    return (
      <View style={[styles.row, { width: w }]}>
        {days.map((key, i) => {
          const selected = key === selectedKey;
          const isToday = key === today;
          return (
            <Pressable key={key} onPress={() => onSelect(key)} style={[styles.cell, selected ? styles.cellSelected : styles.cellIdle]}>
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
    <View style={styles.wrap} onLayout={(e) => setW(pixelWidth(e.nativeEvent.layout.width))}>
      {w > 0 && (
        <FlatList
          key={weekStart}
          ref={listRef}
          style={{ width: w }}
          horizontal
          pagingEnabled
          data={data}
          keyExtractor={(i) => String(i)}
          renderItem={renderWeek}
          extraData={extra}
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
});

const styles = StyleSheet.create({
  dot: { position: 'absolute' },
  plus: { position: 'absolute', borderRadius: 0.6, backgroundColor: C.muted },
  wrap: { marginTop: 14 },
  row: { flexDirection: 'row', gap: 4 },
  cell: { flex: 1, alignItems: 'center', paddingTop: 8, paddingBottom: 7, borderRadius: 14, overflow: 'hidden', position: 'relative' },
  cellSelected: { boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08), 0 6px 18px -8px rgba(124,124,240,0.6)' },
  // Same shadow shape, fully transparent: Android keeps a removed boxShadow,
  // so the idle state sets one explicitly instead of dropping the prop.
  cellIdle: { boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0), 0 6px 18px -8px rgba(124,124,240,0)' },
  dow: { fontSize: 11, fontWeight: '600', opacity: 0.6 },
  num: { fontSize: 16, fontWeight: '600', marginTop: 3 },
  dotsWrap: { marginTop: 5 },
});
