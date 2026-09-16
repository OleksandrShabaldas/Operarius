import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { C } from '../theme';
import { Clock, Repeat, RepeatFreq } from '../types';
import { dateFromKey, dateLabel, weekdayLetters } from '../utils';
import { CenterPopup } from './Overlay';
import { DatePickerPopup } from './pickers';
import { Tappable } from './anim';

const FREQS: { id: RepeatFreq | 'none'; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'yearly', label: 'Yearly' },
];
const UNIT: Record<RepeatFreq, string> = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' };

export function RepeatPopup({
  visible,
  repeat,
  baseDate,
  weekStart,
  onChange,
  onClose,
}: {
  visible: boolean;
  repeat: Repeat | null;
  baseDate: string;
  weekStart: 'mon' | 'sun';
  onChange: (r: Repeat | null) => void;
  onClose: () => void;
}) {
  const [endPick, setEndPick] = useState(false);
  const base = dateFromKey(baseDate);

  const pick = (id: RepeatFreq | 'none') => {
    if (id === 'none') return onChange(null);
    if (repeat && repeat.freq === id) return;
    onChange({
      freq: id,
      interval: repeat?.interval || 1,
      weekdays: id === 'weekly' ? (repeat?.weekdays?.length ? repeat.weekdays : [base.getDay()]) : [],
      monthlyMode: repeat?.monthlyMode || 'date',
      endDate: repeat?.endDate || null,
    });
  };
  const set = (patch: Partial<Repeat>) => repeat && onChange({ ...repeat, ...patch });

  // Weekday order honoring weekStart, mapped to 0=Sun..6=Sat indices.
  const order = weekStart === 'mon' ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
  const letters = weekdayLetters(weekStart);

  return (
    <CenterPopup open={visible} onClose={onClose}>
      <Text style={styles.title}>Repeat</Text>

      <View style={styles.freqWrap}>
        {FREQS.map((f) => {
          const on = (f.id === 'none' && !repeat) || (repeat?.freq === f.id);
          return (
            <Tappable key={f.id} onPress={() => pick(f.id)} style={[styles.freq, on && styles.freqOn]}>
              <Text style={[styles.freqTxt, { color: on ? '#0b0b0d' : C.textDim }]}>{f.label}</Text>
            </Tappable>
          );
        })}
      </View>

      {repeat && (
        <>
          <Text style={styles.section}>EVERY</Text>
          <View style={styles.stepRow}>
            <Tappable onPress={() => set({ interval: Math.max(1, repeat.interval - 1) })} style={styles.stepBtn}>
              <Text style={styles.stepBtnTxt}>−</Text>
            </Tappable>
            <Text style={styles.stepVal}>
              {repeat.interval} {UNIT[repeat.freq]}
              {repeat.interval > 1 ? 's' : ''}
            </Text>
            <Tappable onPress={() => set({ interval: Math.min(99, repeat.interval + 1) })} style={styles.stepBtn}>
              <Text style={styles.stepBtnTxt}>＋</Text>
            </Tappable>
          </View>

          {repeat.freq === 'weekly' && (
            <>
              <Text style={styles.section}>ON</Text>
              <View style={styles.dowRow}>
                {order.map((d, i) => {
                  const on = repeat.weekdays.includes(d);
                  return (
                    <Tappable
                      key={d}
                      onPress={() => set({ weekdays: on ? repeat.weekdays.filter((x) => x !== d) : [...repeat.weekdays, d] })}
                      style={[styles.dow, on && styles.dowOn]}>
                      <Text style={[styles.dowTxt, { color: on ? '#0b0b0d' : C.textDim }]}>{letters[i]}</Text>
                    </Tappable>
                  );
                })}
              </View>
            </>
          )}

          {repeat.freq === 'monthly' && (
            <>
              <Text style={styles.section}>MONTHLY</Text>
              <View style={styles.segment}>
                {(['date', 'weekday'] as const).map((m) => {
                  const on = repeat.monthlyMode === m;
                  return (
                    <Tappable key={m} onPress={() => set({ monthlyMode: m })} style={[styles.seg, on && styles.segOn]}>
                      <Text style={[styles.segTxt, { color: on ? '#0b0b0d' : C.textDim }]}>
                        {m === 'date' ? `On day ${base.getDate()}` : `Same weekday`}
                      </Text>
                    </Tappable>
                  );
                })}
              </View>
            </>
          )}

          <Text style={styles.section}>ENDS</Text>
          <View style={styles.segment}>
            <Tappable onPress={() => set({ endDate: null })} style={[styles.seg, !repeat.endDate && styles.segOn]}>
              <Text style={[styles.segTxt, { color: !repeat.endDate ? '#0b0b0d' : C.textDim }]}>Never</Text>
            </Tappable>
            <Tappable onPress={() => setEndPick(true)} style={[styles.seg, !!repeat.endDate && styles.segOn]}>
              <Text style={[styles.segTxt, { color: repeat.endDate ? '#0b0b0d' : C.textDim }]}>
                {repeat.endDate ? dateLabel(repeat.endDate) : 'On date'}
              </Text>
            </Tappable>
          </View>
        </>
      )}

      <DatePickerPopup
        visible={endPick}
        value={repeat?.endDate || baseDate}
        weekStart={weekStart}
        onChange={(key) => set({ endDate: key })}
        onClose={() => setEndPick(false)}
      />
    </CenterPopup>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 17, fontWeight: '700', color: C.text, marginBottom: 14 },
  freqWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  freq: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)' },
  freqOn: { backgroundColor: C.accentB },
  freqTxt: { fontSize: 13, fontWeight: '700' },
  section: { fontSize: 11, color: C.muted, fontWeight: '600', marginTop: 16, marginBottom: 9 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, padding: 8 },
  stepBtn: { width: 40, height: 40, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.07)', alignItems: 'center', justifyContent: 'center' },
  stepBtnTxt: { fontSize: 20, color: C.textDim },
  stepVal: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: C.text },
  dowRow: { flexDirection: 'row', gap: 6, justifyContent: 'space-between' },
  dow: { flex: 1, height: 40, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
  dowOn: { backgroundColor: C.accentB },
  dowTxt: { fontSize: 13, fontWeight: '700' },
  segment: { flexDirection: 'row', gap: 8 },
  seg: { flex: 1, height: 44, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  segOn: { backgroundColor: C.accentB },
  segTxt: { fontSize: 13, fontWeight: '600' },
});
