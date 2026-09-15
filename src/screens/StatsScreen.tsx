import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import Svg, { Circle, Defs, LinearGradient as SvgGrad, Stop } from 'react-native-svg';
import { C, COLORS } from '../theme';
import { useApp } from '../store';
import { fmtHours, todayKey, weekdayLetters, weekOf } from '../utils';

type Range = 'today' | 'week';

export function StatsScreen({
  onClose,
  onPickDay,
}: {
  onClose: () => void;
  onPickDay: (key: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const { tasks, settings } = useApp();
  const [range, setRange] = useState<Range>('week');

  const today = todayKey();
  const week = useMemo(() => weekOf(today, settings.weekStart), [today, settings.weekStart]);
  const letters = weekdayLetters(settings.weekStart);

  const rangeKeys = range === 'today' ? [today] : week;
  const rangeTasks = useMemo(
    () => tasks.filter((t) => t.type === 'planned' && t.date != null && rangeKeys.includes(t.date)),
    [tasks, rangeKeys.join(',')]
  );

  const total = rangeTasks.length;
  const done = rangeTasks.filter((t) => t.done).length;
  const pct = total ? done / total : 0;
  const schedMin = rangeTasks.reduce((s, t) => s + t.dur, 0);
  const doneMin = rangeTasks.filter((t) => t.done).reduce((s, t) => s + t.dur, 0);
  const windowMin = settings.dayEnd - settings.dayStart;
  const freeMin = Math.max(0, windowMin * rangeKeys.length - schedMin);

  // Per-day breakdown for the week chart.
  const perDay = useMemo(
    () =>
      week.map((key) => {
        const dt = tasks.filter((t) => t.type === 'planned' && t.date === key);
        return {
          key,
          sched: dt.reduce((s, t) => s + t.dur, 0),
          done: dt.filter((t) => t.done).reduce((s, t) => s + t.dur, 0),
        };
      }),
    [tasks, week.join(',')]
  );
  const maxDay = Math.max(60, ...perDay.map((d) => d.sched));

  // Time by tag — grouped by top-level tag (sub-tags roll up into their parent).
  const tagRows = useMemo(() => {
    const tags = settings.tags;
    const topOf = (id: string) => {
      const t = tags.find((x) => x.id === id);
      if (!t) return null;
      return t.parentId ? tags.find((x) => x.id === t.parentId) || t : t;
    };
    const sums = new Map<string, number>();
    let untagged = 0;
    rangeTasks.forEach((t) => {
      const top = t.tagId ? topOf(t.tagId) : null;
      if (!top) untagged += t.dur;
      else sums.set(top.id, (sums.get(top.id) || 0) + t.dur);
    });
    const rows = tags
      .filter((t) => t.parentId == null && (sums.get(t.id) || 0) > 0)
      .map((t, i) => ({ name: t.name, mins: sums.get(t.id) || 0, color: COLORS[i % COLORS.length] }));
    if (untagged > 0) rows.push({ name: 'Untagged', mins: untagged, color: C.faint });
    return rows.sort((a, b) => b.mins - a.mins);
  }, [rangeTasks, settings.tags]);
  const maxTag = Math.max(1, ...tagRows.map((r) => r.mins));

  return (
    <View style={styles.root}>
      <View style={[styles.head, { paddingTop: insets.top }]}>
        <Pressable onPress={onClose} hitSlop={10} style={styles.backBtn}>
          <Feather name="chevron-left" size={24} color={C.text} />
        </Pressable>
        <Text style={styles.headTitle}>Insights</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView
        contentContainerStyle={{ paddingTop: 8, paddingBottom: insets.bottom + 30, paddingHorizontal: 22 }}
        showsVerticalScrollIndicator={false}>
      <View style={styles.segment}>
        {(['today', 'week'] as const).map((r) => {
          const on = range === r;
          return (
            <Pressable key={r} onPress={() => setRange(r)} style={[styles.segBtn, on && styles.segBtnOn]}>
              <Text style={[styles.segTxt, { color: on ? '#0b0b0d' : C.textDim }]}>
                {r === 'today' ? 'Today' : 'This week'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Completion ring + tiles */}
      <View style={styles.card}>
        <View style={styles.ringRow}>
          <Ring pct={pct} />
          <View style={styles.ringMeta}>
            <Text style={styles.ringBig}>
              {done}
              <Text style={styles.ringSlash}> / {total}</Text>
            </Text>
            <Text style={styles.ringLabel}>tasks completed</Text>
            <Text style={styles.ringPct}>{Math.round(pct * 100)}% done</Text>
          </View>
        </View>
        <View style={styles.tiles}>
          <Tile label="Scheduled" value={fmtHours(schedMin)} />
          <Tile label="Completed" value={fmtHours(doneMin)} />
          <Tile label="Free" value={fmtHours(freeMin)} />
        </View>
      </View>

      {/* Weekly chart */}
      <Text style={styles.section}>SCHEDULED PER DAY</Text>
      <View style={styles.card}>
        <View style={styles.chart}>
          {perDay.map((d, i) => {
            const h = Math.round((d.sched / maxDay) * 120);
            const doneH = d.sched ? Math.round((d.done / d.sched) * h) : 0;
            const isToday = d.key === today;
            return (
              <Pressable key={d.key} style={styles.barCol} onPress={() => onPickDay(d.key)}>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.bar,
                      {
                        height: Math.max(h, d.sched ? 6 : 0),
                        backgroundColor: isToday ? C.accentA : 'rgba(255,255,255,0.12)',
                      },
                    ]}>
                    {doneH > 0 && (
                      <View style={[styles.barDone, { height: doneH, backgroundColor: isToday ? C.accentB : 'rgba(255,255,255,0.35)' }]} />
                    )}
                  </View>
                </View>
                <Text style={[styles.barLbl, isToday && { color: C.text }]}>{letters[i]}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.legend}>
          <Legend color={C.accentB} label="Completed" />
          <Legend color="rgba(255,255,255,0.2)" label="Scheduled" />
        </View>
      </View>

      {/* Time by tag */}
      <Text style={styles.section}>TIME BY TAG</Text>
      <View style={styles.card}>
        {tagRows.length === 0 ? (
          <Text style={styles.emptyTxt}>No tasks in this range yet.</Text>
        ) : (
          tagRows.map((r) => (
            <View key={r.name} style={styles.tagRow}>
              <Text style={styles.tagName}>{r.name}</Text>
              <View style={styles.tagBarTrack}>
                <View style={[styles.tagBar, { width: `${(r.mins / maxTag) * 100}%`, backgroundColor: r.color }]} />
              </View>
              <Text style={styles.tagMins}>{fmtHours(r.mins)}</Text>
            </View>
          ))
        )}
      </View>
      </ScrollView>
    </View>
  );
}

function Ring({ pct }: { pct: number }) {
  const size = 104;
  const sw = 12;
  const r = (size - sw) / 2;
  const circ = 2 * Math.PI * r;
  const off = circ * (1 - pct);
  return (
    <Svg width={size} height={size}>
      <Defs>
        <SvgGrad id="ring" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={C.accentA} />
          <Stop offset="1" stopColor={C.accentB} />
        </SvgGrad>
      </Defs>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.08)" strokeWidth={sw} fill="none" />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke="url(#ring)"
        strokeWidth={sw}
        fill="none"
        strokeDasharray={circ}
        strokeDashoffset={off}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </Svg>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileVal}>{value}</Text>
      <Text style={styles.tileLbl}>{label}</Text>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendTxt}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700', color: C.text },
  segment: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  segBtn: { flex: 1, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
  segBtnOn: { backgroundColor: C.accentB },
  segTxt: { fontSize: 13.5, fontWeight: '600' },
  card: {
    backgroundColor: C.card,
    borderRadius: 20,
    padding: 18,
    marginBottom: 18,
    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.05)',
  },
  ringRow: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  ringMeta: { flex: 1 },
  ringBig: { fontSize: 34, fontWeight: '700', color: C.text },
  ringSlash: { fontSize: 22, fontWeight: '600', color: C.faint },
  ringLabel: { fontSize: 13, color: C.muted, marginTop: 2 },
  ringPct: { fontSize: 13, fontWeight: '600', color: C.accentB, marginTop: 6 },
  tiles: { flexDirection: 'row', gap: 10, marginTop: 18 },
  tile: { flex: 1, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
  tileVal: { fontSize: 18, fontWeight: '700', color: C.text },
  tileLbl: { fontSize: 11, color: C.muted, marginTop: 3, fontWeight: '600' },
  section: { fontSize: 11, color: C.muted, fontWeight: '700', letterSpacing: 0.5, marginBottom: 10 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 140 },
  barCol: { flex: 1, alignItems: 'center', gap: 8 },
  barTrack: { height: 120, justifyContent: 'flex-end' },
  bar: { width: 22, borderRadius: 7, justifyContent: 'flex-end', overflow: 'hidden' },
  barDone: { width: '100%', borderRadius: 7 },
  barLbl: { fontSize: 11, fontWeight: '600', color: C.faint },
  legend: { flexDirection: 'row', gap: 16, marginTop: 14, justifyContent: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 9, height: 9, borderRadius: 3 },
  legendTxt: { fontSize: 11, color: C.muted, fontWeight: '600' },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  tagName: { width: 68, fontSize: 12.5, color: C.textDim, fontWeight: '600' },
  tagBarTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.05)', overflow: 'hidden' },
  tagBar: { height: 10, borderRadius: 5 },
  tagMins: { width: 42, textAlign: 'right', fontSize: 12, color: C.muted, fontVariant: ['tabular-nums'] },
  emptyTxt: { color: C.faint, fontSize: 13, textAlign: 'center', paddingVertical: 10 },
});
