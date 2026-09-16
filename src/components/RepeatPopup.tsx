import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { C } from '../theme';
import { Repeat, RepeatFreq } from '../types';
import { dateFromKey, dateLabel, weekdayLetters } from '../utils';
import { BottomSheet } from './Overlay';
import { MonthCalendar } from './pickers';
import { Tappable } from './anim';

type OptId = RepeatFreq | 'none';
const OPTIONS: { id: OptId; label: string }[] = [
  { id: 'none', label: 'Once' },
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'On selected week days' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'yearly', label: 'Yearly' },
];
const UNIT: Record<RepeatFreq, string> = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' };
const ORDINALS = ['first', 'second', 'third', 'fourth', 'last'];

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
  const [page, setPage] = useState<'main' | 'end'>('main');
  useEffect(() => {
    if (visible) setPage('main');
  }, [visible]);

  const base = dateFromKey(baseDate);
  const order = weekStart === 'mon' ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
  const letters = weekdayLetters(weekStart);
  const weekOfMonth = Math.min(4, Math.floor((base.getDate() - 1) / 7));

  const pick = (id: OptId) => {
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

  return (
    <BottomSheet open={visible} onClose={onClose}>
      {page === 'main' ? (
        <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
          <Text style={styles.title}>Repeat</Text>

          {OPTIONS.map((o, i) => {
            const on = (o.id === 'none' && !repeat) || repeat?.freq === o.id;
            const showWeek = o.id === 'weekly' && repeat?.freq === 'weekly';
            const showMonth = o.id === 'monthly' && repeat?.freq === 'monthly';
            return (
              <View key={o.id}>
                {i > 0 && <View style={styles.divider} />}
                <Tappable onPress={() => pick(o.id)} style={styles.optRow}>
                  <View style={[styles.radio, on && styles.radioOn]}>{on && <View style={styles.radioDot} />}</View>
                  <Text style={[styles.optLabel, on && { color: C.text }]}>{o.label}</Text>
                </Tappable>

                {showWeek && (
                  <View style={styles.dowRow}>
                    {order.map((d, idx) => {
                      const sel = repeat!.weekdays.includes(d);
                      return (
                        <Tappable
                          key={d}
                          onPress={() => set({ weekdays: sel ? repeat!.weekdays.filter((x) => x !== d) : [...repeat!.weekdays, d] })}
                          style={[styles.dow, sel && styles.dowOn]}>
                          <Text style={[styles.dowTxt, { color: sel ? '#0b0b0d' : C.textDim }]}>{letters[idx]}</Text>
                        </Tappable>
                      );
                    })}
                  </View>
                )}

                {showMonth && (
                  <View style={styles.subSeg}>
                    {(['date', 'weekday'] as const).map((m) => {
                      const sel = repeat!.monthlyMode === m;
                      return (
                        <Tappable key={m} onPress={() => set({ monthlyMode: m })} style={[styles.seg, sel && styles.segOn]}>
                          <Text style={[styles.segTxt, { color: sel ? '#0b0b0d' : C.textDim }]}>
                            {m === 'date' ? `On day ${base.getDate()}` : `On the ${ORDINALS[weekOfMonth]} ${dowName(base.getDay())}`}
                          </Text>
                        </Tappable>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })}

          {repeat && (
            <View style={styles.footer}>
              <View style={styles.footRow}>
                <Text style={styles.footLabel}>Repeat every</Text>
                <View style={styles.stepper}>
                  <Tappable onPress={() => set({ interval: Math.max(1, repeat.interval - 1) })} style={styles.stepBtn}>
                    <Feather name="minus" size={16} color={C.textDim} />
                  </Tappable>
                  <Text style={styles.stepVal}>
                    {repeat.interval} {UNIT[repeat.freq]}
                    {repeat.interval > 1 ? 's' : ''}
                  </Text>
                  <Tappable onPress={() => set({ interval: Math.min(99, repeat.interval + 1) })} style={styles.stepBtn}>
                    <Feather name="plus" size={16} color={C.textDim} />
                  </Tappable>
                </View>
              </View>

              <View style={[styles.footRow, { marginTop: 12 }]}>
                <Text style={styles.footLabel}>Ends</Text>
                <View style={styles.endWrap}>
                  <Tappable onPress={() => set({ endDate: null })} style={[styles.endBtn, !repeat.endDate && styles.endOn]}>
                    <Text style={[styles.endTxt, { color: !repeat.endDate ? '#0b0b0d' : C.textDim }]}>Never</Text>
                  </Tappable>
                  <Tappable onPress={() => setPage('end')} style={[styles.endBtn, !!repeat.endDate && styles.endOn]}>
                    <Text style={[styles.endTxt, { color: repeat.endDate ? '#0b0b0d' : C.textDim }]}>
                      {repeat.endDate ? dateLabel(repeat.endDate) : 'On date'}
                    </Text>
                  </Tappable>
                </View>
              </View>
            </View>
          )}

          <Tappable onPress={onClose} style={styles.done}>
            <Text style={styles.doneTxt}>Done</Text>
          </Tappable>
        </ScrollView>
      ) : (
        <View>
          <View style={styles.endHead}>
            <Tappable onPress={() => setPage('main')} hitSlop={8} style={styles.backBtn}>
              <Feather name="chevron-left" size={22} color={C.text} />
            </Tappable>
            <Text style={styles.title}>Ends on</Text>
            <View style={{ width: 40 }} />
          </View>
          <MonthCalendar
            value={repeat?.endDate || baseDate}
            weekStart={weekStart}
            onChange={(key) => {
              set({ endDate: key });
              setPage('main');
            }}
          />
        </View>
      )}
    </BottomSheet>
  );
}

const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dowName = (d: number) => DOW_FULL[d];

const styles = StyleSheet.create({
  title: { fontSize: 18, fontWeight: '700', color: C.text, marginBottom: 6 },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.07)', marginLeft: 40 },
  optRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 15 },
  radio: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.22)' },
  radioOn: { boxShadow: `inset 0 0 0 2px ${C.accentA}` },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: C.accentA },
  optLabel: { fontSize: 16, fontWeight: '600', color: C.textDim },
  dowRow: { flexDirection: 'row', gap: 6, paddingLeft: 40, paddingBottom: 14, paddingTop: 2 },
  dow: { flex: 1, height: 40, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
  dowOn: { backgroundColor: C.accentB },
  dowTxt: { fontSize: 13, fontWeight: '700' },
  subSeg: { flexDirection: 'row', gap: 8, paddingLeft: 40, paddingBottom: 14, paddingTop: 2 },
  seg: { flex: 1, height: 42, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  segOn: { backgroundColor: C.accentB },
  segTxt: { fontSize: 12.5, fontWeight: '700', textAlign: 'center' },
  footer: { marginTop: 14, paddingTop: 16, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)' },
  footRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  footLabel: { fontSize: 14, fontWeight: '600', color: C.textDim },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: 5 },
  stepBtn: { width: 34, height: 34, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  stepVal: { minWidth: 84, textAlign: 'center', fontSize: 14, fontWeight: '700', color: C.text },
  endWrap: { flexDirection: 'row', gap: 6 },
  endBtn: { paddingHorizontal: 14, height: 38, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
  endOn: { backgroundColor: C.accentB },
  endTxt: { fontSize: 13, fontWeight: '700' },
  done: { height: 50, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  doneTxt: { fontSize: 15, fontWeight: '700', color: C.text },
  endHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
