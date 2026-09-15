import React, { useEffect, useRef, useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, MONTHS } from '../theme';
import { Clock } from '../types';
import { dateFromKey, dateKey, fmt, fmtDur, weekdayLetters } from '../utils';
import { CenterPopup as Popup } from './Overlay';
import { Tappable } from './anim';

const ITEM_H = 44;
const WHEEL_VISIBLE = 5;

// A single scrollable wheel column — scroll to select, snaps to the centered
// item and reports it live. Edges fade into the popup background.
function WheelColumn({
  values,
  value,
  format,
  onChange,
  width,
}: {
  values: number[];
  value: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  width?: number;
}) {
  const ref = useRef<ScrollView>(null);
  const nearestIndex = () => {
    let bi = 0;
    let bd = Infinity;
    values.forEach((v, i) => {
      const d = Math.abs(v - value);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    });
    return bi;
  };
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      const i = nearestIndex();
      ref.current?.scrollTo({ y: i * ITEM_H, animated: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  useEffect(() => {
    const i = nearestIndex();
    const t = setTimeout(() => ref.current?.scrollTo({ y: i * ITEM_H, animated: false }), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.y / ITEM_H);
    const clamped = Math.max(0, Math.min(values.length - 1, i));
    const v = values[clamped];
    if (v !== last.current) {
      last.current = v;
      onChange(v);
    }
  };

  return (
    <View style={[styles.wheel, width != null ? { width } : null]}>
      <ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_H}
        decelerationRate="fast"
        scrollEventThrottle={16}
        onScroll={onScroll}
        contentContainerStyle={{ paddingVertical: ITEM_H * 2 }}>
        {values.map((v) => (
          <View key={v} style={styles.wheelItem}>
            <Text style={[styles.wheelTxt, v === value && styles.wheelTxtOn]}>{format(v)}</Text>
          </View>
        ))}
      </ScrollView>
      <View pointerEvents="none" style={styles.wheelCenter} />
      <LinearGradient pointerEvents="none" colors={[C.sheet, C.sheet + '00']} style={[styles.wheelFade, { top: 0 }]} />
      <LinearGradient pointerEvents="none" colors={[C.sheet + '00', C.sheet]} style={[styles.wheelFade, { bottom: 0 }]} />
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


// ---- Time-of-day picker ---------------------------------------------------
export function TimePickerPopup({
  visible,
  title,
  value,
  presets,
  clock,
  min = 0,
  max = 24 * 60,
  onChange,
  onClose,
}: {
  visible: boolean;
  title: string;
  value: number;
  presets: number[];
  clock: Clock;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  onClose: () => void;
}) {
  return (
    <CenterPopup visible={visible} title={title} onClose={onClose}>
      <View style={styles.wheelRow}>
        <WheelColumn values={range(min, max, 5)} value={value} format={(v) => fmt(v, clock)} onChange={onChange} width={160} />
      </View>
      {presets.length > 0 && <Text style={styles.section}>PRESETS</Text>}
      <View style={styles.chipWrap}>
        {presets.map((p) => (
          <Pressable key={p} onPress={() => onChange(p)} style={[styles.chip, value === p && styles.chipOn]}>
            <Text style={[styles.chipTxt, value === p && styles.chipTxtOn]}>{fmt(p, clock)}</Text>
          </Pressable>
        ))}
      </View>
    </CenterPopup>
  );
}

// ---- Duration picker ------------------------------------------------------
export function DurationPickerPopup({
  visible,
  value,
  presets,
  onChange,
  onClose,
}: {
  visible: boolean;
  value: number;
  presets: number[];
  onChange: (v: number) => void;
  onClose: () => void;
}) {
  return (
    <CenterPopup visible={visible} title="Duration" onClose={onClose}>
      <View style={styles.wheelRow}>
        <WheelColumn values={range(5, 480, 5)} value={value} format={fmtDur} onChange={onChange} width={160} />
      </View>
      {presets.length > 0 && <Text style={styles.section}>PRESETS</Text>}
      <View style={styles.chipWrap}>
        {presets.map((p) => (
          <Pressable key={p} onPress={() => onChange(p)} style={[styles.chip, value === p && styles.chipOn]}>
            <Text style={[styles.chipTxt, value === p && styles.chipTxtOn]}>{fmtDur(p)}</Text>
          </Pressable>
        ))}
      </View>
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
          <Pressable onPress={() => onSelect(null)} style={[styles.row, selectedId == null && styles.rowOn]}>
            <Text style={[styles.rowTxt, { color: C.muted }]}>None</Text>
            {selectedId == null && <Text style={styles.check}>✓</Text>}
          </Pressable>
          {options.map((o) => {
            const on = o.id === selectedId;
            return (
              <Pressable key={o.id} onPress={() => onSelect(o.id)} style={[styles.row, on && styles.rowOn]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTxt}>{o.label}</Text>
                  {!!o.sub && <Text style={styles.rowSub}>{o.sub}</Text>}
                </View>
                {on && <Text style={styles.check}>✓</Text>}
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </CenterPopup>
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
  const base = dateFromKey(value);
  const [view, setView] = useState({ y: base.getFullYear(), m: base.getMonth() });
  // Re-sync the shown month whenever the popup opens on a new value.
  React.useEffect(() => {
    if (visible) setView({ y: base.getFullYear(), m: base.getMonth() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, value]);

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
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    setView({ y, m });
  };

  return (
    <CenterPopup visible={visible} title="Date" onClose={onClose}>
      <View style={styles.calHead}>
        <Pressable onPress={() => shift(-1)} hitSlop={10} style={styles.calArrow}>
          <Text style={styles.calArrowTxt}>‹</Text>
        </Pressable>
        <Text style={styles.calMonth}>
          {MONTHS[view.m]} {view.y}
        </Text>
        <Pressable onPress={() => shift(1)} hitSlop={10} style={styles.calArrow}>
          <Text style={styles.calArrowTxt}>›</Text>
        </Pressable>
      </View>
      <View style={styles.calRow}>
        {weekdayLetters(weekStart).map((l, i) => (
          <Text key={i} style={styles.calDow}>{l}</Text>
        ))}
      </View>
      <View style={styles.calGrid}>
        {cells.map((d, i) => {
          if (d == null) return <View key={i} style={styles.calCell} />;
          const key = dateKey(new Date(view.y, view.m, d));
          const on = key === value;
          return (
            <Pressable key={i} style={styles.calCell} onPress={() => onChange(key)}>
              <View style={[styles.calDay, on && styles.calDayOn]}>
                <Text style={[styles.calDayTxt, on && styles.calDayTxtOn]}>{d}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </CenterPopup>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 26 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: C.sheet,
    borderRadius: 22,
    padding: 20,
    boxShadow: '0 24px 70px -20px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(255,255,255,0.07)',
  },
  title: { fontSize: 17, fontWeight: '700', color: C.text, marginBottom: 14 },
  done: { height: 48, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  doneTxt: { fontSize: 15, fontWeight: '700', color: C.text },
  stepCtrl: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, padding: 10 },
  stepBtn: { width: 40, height: 40, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.07)', alignItems: 'center', justifyContent: 'center' },
  stepBtnTxt: { fontSize: 20, color: C.textDim },
  stepVal: { flex: 1, textAlign: 'center', fontSize: 22, fontWeight: '700', color: C.text, fontVariant: ['tabular-nums'] },
  section: { fontSize: 11, color: C.muted, fontWeight: '600', marginTop: 16, marginBottom: 9 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  wheelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 16, paddingVertical: 4 },
  wheel: { height: ITEM_H * WHEEL_VISIBLE, overflow: 'hidden', position: 'relative' },
  wheelItem: { height: ITEM_H, alignItems: 'center', justifyContent: 'center' },
  wheelTxt: { fontSize: 19, fontWeight: '600', color: C.faint, fontVariant: ['tabular-nums'] },
  wheelTxtOn: { color: C.text, fontWeight: '700' },
  wheelCenter: { position: 'absolute', left: 0, right: 0, top: ITEM_H * 2, height: ITEM_H, borderTopWidth: 1, borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  wheelFade: { position: 'absolute', left: 0, right: 0, height: ITEM_H * 1.8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)' },
  chipOn: { backgroundColor: C.accentB },
  chipTxt: { fontSize: 13, fontWeight: '600', color: C.textDim, fontVariant: ['tabular-nums'] },
  chipTxtOn: { color: '#0b0b0d' },
  empty: { color: C.faint, fontSize: 13, paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 14, borderRadius: 12, marginBottom: 4 },
  rowOn: { backgroundColor: 'rgba(79,209,197,0.14)' },
  rowTxt: { fontSize: 15, fontWeight: '600', color: C.text },
  rowSub: { fontSize: 12, color: C.muted, marginTop: 2 },
  check: { fontSize: 16, fontWeight: '700', color: C.accentB },
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
