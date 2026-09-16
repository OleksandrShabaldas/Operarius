import React, { useEffect, useRef, useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  interpolateColor,
  runOnJS,
  SharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { C, MONTHS } from '../theme';
import { Clock } from '../types';
import { dateFromKey, dateKey, fmt, fmtDur, hexA, weekdayLetters } from '../utils';
import { CenterPopup as Popup } from './Overlay';
import { Tappable } from './anim';

const ITEM_H = 40;
const VISIBLE = 5; // odd — one centered row + two on each side
const PAD = ITEM_H * ((VISIBLE - 1) / 2);
const WHEEL_H = ITEM_H * VISIBLE;

const pad2 = (n: number) => String(n).padStart(2, '0');
function haptic() {
  try {
    Haptics.selectionAsync().catch(() => {});
  } catch {}
}

// A single item on the drum — scales/rotates/fades with its distance from the
// centre so the column reads as a rounded 3D wheel.
function WheelItem({ i, scrollY, label }: { i: number; scrollY: SharedValue<number>; label: string }) {
  const aStyle = useAnimatedStyle(() => {
    const pos = i - scrollY.value / ITEM_H; // 0 when this row is centred
    const abs = Math.abs(pos);
    const rotateX = interpolate(pos, [-2.4, 0, 2.4], [58, 0, -58], Extrapolation.CLAMP);
    const scale = interpolate(abs, [0, 1, 2.4], [1, 0.84, 0.66], Extrapolation.CLAMP);
    const opacity = interpolate(abs, [0, 1, 2.3], [1, 0.5, 0.1], Extrapolation.CLAMP);
    const color = interpolateColor(abs, [0, 0.85], [C.text, C.faint]);
    return { opacity, color, transform: [{ perspective: 520 }, { rotateX: `${rotateX}deg` }, { scale }] };
  });
  return <Animated.Text style={[styles.wheelTxt, aStyle]}>{label}</Animated.Text>;
}

// A scrollable drum column. `index` is the selected row; the parent keeps it in
// sync and the wheel reports back through `onIndex` once it settles.
function Wheel({
  values,
  index,
  onIndex,
  format,
  width,
}: {
  values: number[];
  index: number;
  onIndex: (i: number) => void;
  format: (v: number) => string;
  width: number;
}) {
  const scrollY = useSharedValue(index * ITEM_H);
  const lastTick = useSharedValue(index);
  const ref = useRef<ScrollView>(null);
  const selfIndex = useRef(index);

  // Snap to the initial row once laid out.
  useEffect(() => {
    selfIndex.current = index;
    scrollY.value = index * ITEM_H;
    const t = setTimeout(() => ref.current?.scrollTo({ y: index * ITEM_H, animated: false }), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow external changes (e.g. a preset tap) without fighting user scrolls.
  useEffect(() => {
    if (index !== selfIndex.current) {
      selfIndex.current = index;
      ref.current?.scrollTo({ y: index * ITEM_H, animated: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const handler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
      const i = Math.round(e.contentOffset.y / ITEM_H);
      if (i !== lastTick.value) {
        lastTick.value = i;
        runOnJS(haptic)();
      }
    },
  });

  const settle = (y: number) => {
    const i = Math.max(0, Math.min(values.length - 1, Math.round(y / ITEM_H)));
    if (i !== selfIndex.current) {
      selfIndex.current = i;
      onIndex(i);
    }
  };

  return (
    <View style={[styles.wheel, { width }]}>
      <Animated.ScrollView
        ref={ref as any}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_H}
        decelerationRate="fast"
        scrollEventThrottle={16}
        onScroll={handler}
        onMomentumScrollEnd={(e: NativeSyntheticEvent<NativeScrollEvent>) => settle(e.nativeEvent.contentOffset.y)}
        onScrollEndDrag={(e: NativeSyntheticEvent<NativeScrollEvent>) => settle(e.nativeEvent.contentOffset.y)}
        contentContainerStyle={{ paddingVertical: PAD }}>
        {values.map((v, i) => (
          <WheelItem key={i} i={i} scrollY={scrollY} label={format(v)} />
        ))}
      </Animated.ScrollView>
      <LinearGradient pointerEvents="none" colors={[C.sheet, hexA(C.sheet, 0)]} style={[styles.fade, { top: 0 }]} />
      <LinearGradient pointerEvents="none" colors={[hexA(C.sheet, 0), C.sheet]} style={[styles.fade, { bottom: 0 }]} />
    </View>
  );
}

function range(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  for (let v = from; v <= to; v += step) out.push(v);
  return out;
}

// ---- Reusable centered popup ---------------------------------------------
export function CenterPopup({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Popup open={visible} onClose={onClose}>
      <Text style={styles.title}>{title}</Text>
      {children}
      <Tappable onPress={onClose} style={styles.done}>
        <Text style={styles.doneTxt}>Done</Text>
      </Tappable>
    </Popup>
  );
}

// Scope switch + centred preset chips, shared by the time & duration pickers.
function Presets({
  presets,
  tagPresets,
  tagName,
  value,
  format,
  onPick,
}: {
  presets: number[];
  tagPresets: number[];
  tagName: string | null;
  value: number;
  format: (v: number) => string;
  onPick: (v: number) => void;
}) {
  const hasTag = !!tagName && tagPresets.length > 0;
  const [scope, setScope] = useState<'global' | 'tag'>(hasTag ? 'tag' : 'global');
  useEffect(() => {
    setScope(hasTag ? 'tag' : 'global');
  }, [hasTag, tagName]);

  const list = scope === 'tag' ? tagPresets : presets;
  if (presets.length === 0 && tagPresets.length === 0) return null;

  return (
    <>
      {hasTag && (
        <View style={styles.scopeRow}>
          <Tappable onPress={() => setScope('global')} style={[styles.scopeBtn, scope === 'global' && styles.scopeOn]}>
            <Text style={[styles.scopeTxt, { color: scope === 'global' ? '#0b0b0d' : C.textDim }]}>Global</Text>
          </Tappable>
          <Tappable onPress={() => setScope('tag')} style={[styles.scopeBtn, scope === 'tag' && styles.scopeOn]}>
            <Text style={[styles.scopeTxt, { color: scope === 'tag' ? '#0b0b0d' : C.textDim }]} numberOfLines={1}>
              {tagName}
            </Text>
          </Tappable>
        </View>
      )}
      <View style={styles.chipWrap}>
        {list.length === 0 ? (
          <Text style={styles.empty}>No presets in this scope yet.</Text>
        ) : (
          list.map((p, i) => (
            <Tappable key={`${p}-${i}`} onPress={() => onPick(p)} style={[styles.chip, value === p && styles.chipOn]}>
              <Text style={[styles.chipTxt, value === p && styles.chipTxtOn]}>{format(p)}</Text>
            </Tappable>
          ))
        )}
      </View>
    </>
  );
}

// ---- Time-of-day picker (separate hour / minute drums) --------------------
export function TimePickerPopup({
  visible,
  title,
  value,
  presets = [],
  tagPresets = [],
  tagName = null,
  clock,
  min = 0,
  max = 24 * 60 - 5,
  onChange,
  onClose,
}: {
  visible: boolean;
  title: string;
  value: number;
  presets?: number[];
  tagPresets?: number[];
  tagName?: string | null;
  clock: Clock;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  onClose: () => void;
}) {
  const is12 = clock === '12h';
  const h24 = Math.floor(value / 60) % 24;
  const minVal = value % 60;
  const minIdx = Math.round(minVal / 5) % 12;
  const hourIdx = is12 ? (h24 % 12 === 0 ? 11 : (h24 % 12) - 1) : h24;
  const ampmIdx = h24 < 12 ? 0 : 1;

  const hourValues = is12 ? range(1, 12, 1) : range(0, 23, 1);
  const minuteValues = range(0, 55, 5);

  const commit = (hIdx: number, mIdx: number, apIdx: number) => {
    const h = is12 ? ((hIdx + 1) % 12) + (apIdx ? 12 : 0) : hIdx;
    const v = Math.max(min, Math.min(max, h * 60 + mIdx * 5));
    onChange(v);
  };

  return (
    <CenterPopup visible={visible} title={title} onClose={onClose}>
      <View style={styles.wheelRow}>
        <View pointerEvents="none" style={styles.wheelBand} />
        <Wheel values={hourValues} index={hourIdx} onIndex={(i) => commit(i, minIdx, ampmIdx)} format={(v) => pad2(v)} width={64} />
        <Text style={styles.colon}>:</Text>
        <Wheel values={minuteValues} index={minIdx} onIndex={(i) => commit(hourIdx, i, ampmIdx)} format={(v) => pad2(v)} width={64} />
        {is12 && (
          <Wheel values={[0, 1]} index={ampmIdx} onIndex={(i) => commit(hourIdx, minIdx, i)} format={(v) => (v === 0 ? 'AM' : 'PM')} width={64} />
        )}
      </View>
      <Presets presets={presets} tagPresets={tagPresets} tagName={tagName} value={value} format={(v) => fmt(v, clock)} onPick={onChange} />
    </CenterPopup>
  );
}

// ---- Duration picker (hours / minutes drums) ------------------------------
export function DurationPickerPopup({
  visible,
  value,
  presets = [],
  tagPresets = [],
  tagName = null,
  onChange,
  onClose,
}: {
  visible: boolean;
  value: number;
  presets?: number[];
  tagPresets?: number[];
  tagName?: string | null;
  onChange: (v: number) => void;
  onClose: () => void;
}) {
  const h = Math.min(12, Math.floor(value / 60));
  const m = value % 60;
  const minIdx = Math.round(m / 5) % 12;
  const hourValues = range(0, 12, 1);
  const minuteValues = range(0, 55, 5);

  const commit = (hIdx: number, mIdx: number) => onChange(Math.max(5, hIdx * 60 + mIdx * 5));

  return (
    <CenterPopup visible={visible} title="Duration" onClose={onClose}>
      <View style={styles.wheelRow}>
        <View pointerEvents="none" style={styles.wheelBand} />
        <Wheel values={hourValues} index={h} onIndex={(i) => commit(i, minIdx)} format={(v) => String(v)} width={56} />
        <Text style={styles.unit}>h</Text>
        <Wheel values={minuteValues} index={minIdx} onIndex={(i) => commit(h, i)} format={(v) => pad2(v)} width={56} />
        <Text style={styles.unit}>m</Text>
      </View>
      <Presets presets={presets} tagPresets={tagPresets} tagName={tagName} value={value} format={fmtDur} onPick={onChange} />
    </CenterPopup>
  );
}

// ---- Single-select list popup (tags / places) -----------------------------
export type SelectOption = { id: string; label: string; sub?: string };
export function SelectPopup({
  visible,
  title,
  options,
  selectedId,
  emptyText,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: SelectOption[];
  selectedId: string | null;
  emptyText?: string;
  onSelect: (id: string | null) => void;
  onClose: () => void;
}) {
  return (
    <CenterPopup visible={visible} title={title} onClose={onClose}>
      {options.length === 0 ? (
        <Text style={styles.empty}>{emptyText || 'Nothing here yet — add some in Settings.'}</Text>
      ) : (
        <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
          <Tappable onPress={() => onSelect(null)} style={[styles.row, selectedId == null && styles.rowOn]}>
            <Text style={[styles.rowTxt, { color: C.muted }]}>None</Text>
            {selectedId == null && <Text style={styles.check}>✓</Text>}
          </Tappable>
          {options.map((o) => {
            const on = o.id === selectedId;
            return (
              <Tappable key={o.id} onPress={() => onSelect(o.id)} style={[styles.row, on && styles.rowOn]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTxt}>{o.label}</Text>
                  {!!o.sub && <Text style={styles.rowSub}>{o.sub}</Text>}
                </View>
                {on && <Text style={styles.check}>✓</Text>}
              </Tappable>
            );
          })}
        </ScrollView>
      )}
    </CenterPopup>
  );
}

// ---- Month calendar (reused by the date picker and the repeat end-date) ----
export function MonthCalendar({
  value,
  weekStart,
  onChange,
}: {
  value: string;
  weekStart: 'mon' | 'sun';
  onChange: (key: string) => void;
}) {
  const base = dateFromKey(value);
  const [view, setView] = useState({ y: base.getFullYear(), m: base.getMonth() });
  useEffect(() => {
    setView({ y: base.getFullYear(), m: base.getMonth() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const first = new Date(view.y, view.m, 1);
  const startDow = weekStart === 'mon' ? (first.getDay() + 6) % 7 : first.getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const shift = (delta: number) => {
    let m = view.m + delta;
    let y = view.y;
    if (m < 0) {
      m = 11;
      y--;
    }
    if (m > 11) {
      m = 0;
      y++;
    }
    setView({ y, m });
  };

  return (
    <>
      <View style={styles.calHead}>
        <Tappable onPress={() => shift(-1)} hitSlop={10} style={styles.calArrow}>
          <Text style={styles.calArrowTxt}>‹</Text>
        </Tappable>
        <Text style={styles.calMonth}>
          {MONTHS[view.m]} {view.y}
        </Text>
        <Tappable onPress={() => shift(1)} hitSlop={10} style={styles.calArrow}>
          <Text style={styles.calArrowTxt}>›</Text>
        </Tappable>
      </View>
      <View style={styles.calRow}>
        {weekdayLetters(weekStart).map((l, i) => (
          <Text key={i} style={styles.calDow}>
            {l}
          </Text>
        ))}
      </View>
      <View style={styles.calGrid}>
        {cells.map((d, i) => {
          if (d == null) return <View key={i} style={styles.calCell} />;
          const key = dateKey(new Date(view.y, view.m, d));
          const on = key === value;
          return (
            <Tappable key={i} style={styles.calCell} onPress={() => onChange(key)}>
              <View style={[styles.calDay, on && styles.calDayOn]}>
                <Text style={[styles.calDayTxt, on && styles.calDayTxtOn]}>{d}</Text>
              </View>
            </Tappable>
          );
        })}
      </View>
    </>
  );
}

// ---- Month calendar date picker ------------------------------------------
export function DatePickerPopup({
  visible,
  value,
  weekStart,
  onChange,
  onClose,
}: {
  visible: boolean;
  value: string; // YYYY-MM-DD
  weekStart: 'mon' | 'sun';
  onChange: (key: string) => void;
  onClose: () => void;
}) {
  return (
    <CenterPopup visible={visible} title="Date" onClose={onClose}>
      <MonthCalendar value={value} weekStart={weekStart} onChange={onChange} />
    </CenterPopup>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 17, fontWeight: '700', color: C.text, marginBottom: 14 },
  done: { height: 48, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  doneTxt: { fontSize: 15, fontWeight: '700', color: C.text },
  section: { fontSize: 11, color: C.muted, fontWeight: '600', marginTop: 16, marginBottom: 9 },

  // Wheel
  wheelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    height: WHEEL_H,
    backgroundColor: 'rgba(255,255,255,0.035)',
    borderRadius: 18,
    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.05)',
    position: 'relative',
  },
  wheelBand: {
    position: 'absolute',
    left: 14,
    right: 14,
    top: PAD,
    height: ITEM_H,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.07)',
    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)',
  },
  wheel: { height: WHEEL_H, overflow: 'hidden' },
  wheelTxt: { height: ITEM_H, lineHeight: ITEM_H, textAlign: 'center', fontSize: 23, fontWeight: '700', fontVariant: ['tabular-nums'] },
  fade: { position: 'absolute', left: 0, right: 0, height: ITEM_H * 1.9 },
  colon: { fontSize: 23, fontWeight: '800', color: C.text, marginHorizontal: 1 },
  unit: { fontSize: 15, fontWeight: '700', color: C.muted, marginHorizontal: 2 },

  // Presets
  scopeRow: { flexDirection: 'row', gap: 6, marginTop: 16, marginBottom: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: 4 },
  scopeBtn: { flex: 1, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  scopeOn: { backgroundColor: C.accentB },
  scopeTxt: { fontSize: 13, fontWeight: '700' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 14 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)' },
  chipOn: { backgroundColor: C.accentB },
  chipTxt: { fontSize: 13, fontWeight: '700', color: C.textDim, fontVariant: ['tabular-nums'] },
  chipTxtOn: { color: '#0b0b0d' },
  empty: { color: C.faint, fontSize: 13, paddingVertical: 8, textAlign: 'center', width: '100%' },

  // Select list
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 14, borderRadius: 12, marginBottom: 4 },
  rowOn: { backgroundColor: 'rgba(79,209,197,0.14)' },
  rowTxt: { fontSize: 15, fontWeight: '600', color: C.text },
  rowSub: { fontSize: 12, color: C.muted, marginTop: 2 },
  check: { fontSize: 16, fontWeight: '700', color: C.accentB },

  // Calendar
  calHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  calArrow: { width: 40, height: 40, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
  calArrowTxt: { fontSize: 22, color: C.textDim, marginTop: -2 },
  calMonth: { fontSize: 15, fontWeight: '700', color: C.text },
  calRow: { flexDirection: 'row' },
  calDow: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600', color: C.muted, marginBottom: 4 },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', padding: 2 },
  calDay: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  calDayOn: { backgroundColor: C.accentB },
  calDayTxt: { fontSize: 14, fontWeight: '600', color: C.text },
  calDayTxtOn: { color: '#0b0b0d', fontWeight: '700' },
});
