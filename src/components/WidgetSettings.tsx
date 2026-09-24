import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import * as W from '../../modules/widgets';
import type { WidgetKind, WidgetStatus } from '../../modules/widgets';
import { C, MONTHS, WEEKDAYS_FULL } from '../theme';
import { useApp } from '../store';
import { Settings, Task } from '../types';
import { dateKey, fmt, fmtDur, hexA, todayKey } from '../utils';
import { expandRange, widgetOrder } from '../widgets';
import { Appear, Tappable } from './anim';

type Icon = keyof typeof Feather.glyphMap;

// ---------------------------------------------------------------------------
// Settings → Widgets: both widgets previewed with your own tasks, and a way to
// put them on the home screen.
// ---------------------------------------------------------------------------
export function WidgetSettings() {
  const { tasks, settings } = useApp();
  const [status, setStatus] = useState<WidgetStatus>({ today: 0, month: 0, canPin: false });
  const [asked, setAsked] = useState<WidgetKind | null>(null);

  const load = useCallback(() => {
    W.status().then(setStatus);
  }, []);
  useEffect(() => {
    load();
    // Back from the launcher's "Add widget" dialog (or the home screen).
    const sub = AppState.addEventListener('change', (s) => s === 'active' && load());
    return () => sub.remove();
  }, [load]);

  const add = async (kind: WidgetKind) => {
    Haptics.selectionAsync().catch(() => {});
    const ok = await W.pin(kind);
    setAsked(ok ? kind : null);
    if (!ok) setStatus((s) => ({ ...s, canPin: false }));
    setTimeout(load, 1500);
  };

  return (
    <View style={{ marginTop: 10 }}>
      {!W.available && (
        <Appear from="up" delay={20} style={styles.note}>
          <Feather name="smartphone" size={14} color={C.muted} />
          <Text style={styles.noteTxt}>Widgets live on your Android home screen — here’s how they’ll look with your tasks.</Text>
        </Appear>
      )}

      <Text style={[styles.section, { marginTop: W.available ? 6 : 20 }]}>TODAY</Text>
      <Appear from="up" delay={40}>
        <TodayPreview tasks={tasks} settings={settings} />
      </Appear>
      <AddRow kind="today" count={status.today} canPin={status.canPin} asked={asked === 'today'} onAdd={() => add('today')} delay={90} />

      <Text style={styles.section}>MONTH</Text>
      <Appear from="up" delay={120}>
        <MonthPreview tasks={tasks} settings={settings} />
      </Appear>
      <AddRow kind="month" count={status.month} canPin={status.canPin} asked={asked === 'month'} onAdd={() => add('month')} delay={170} />

      <Text style={styles.section}>HOW THEY WORK</Text>
      <Appear from="up" delay={60} style={styles.card}>
        <Tip icon="clock" text="Today follows the clock: what’s on now is highlighted and the now line moves along. Tap a task to open it, + to add one." />
        <Tip icon="star" text="The month shows up to three tasks a day — starred first, then all-day ones, then by time. Tap a day to open it; the arrows change the month." />
        <Tip icon="refresh-cw" text="They update as you plan, and keep going on their own for a week even if you don’t open the app." last />
      </Appear>
      {W.available && !status.canPin && (
        <Appear from="up" style={styles.note}>
          <Feather name="info" size={14} color={C.muted} />
          <Text style={styles.noteTxt}>To add one: touch and hold an empty spot on your home screen, pick Widgets, then find Operarius.</Text>
        </Appear>
      )}
    </View>
  );
}

function AddRow({ kind, count, canPin, asked, onAdd, delay }: { kind: WidgetKind; count: number; canPin: boolean; asked: boolean; onAdd: () => void; delay: number }) {
  return (
    <Appear from="up" delay={delay} style={styles.addRow}>
      {count > 0 ? (
        <Appear key="on" from="pop" style={styles.onBadge}>
          <Feather name="check" size={12} color={C.accentB} />
          <Text style={styles.onBadgeTxt}>{count > 1 ? `${count} on your home screen` : 'On your home screen'}</Text>
        </Appear>
      ) : asked ? (
        <Appear key="asked" from="pop" style={styles.onBadge}>
          <Feather name="smartphone" size={12} color={C.accentB} />
          <Text style={styles.onBadgeTxt}>Confirm on your home screen</Text>
        </Appear>
      ) : (
        <View style={{ flex: 1 }} />
      )}
      {W.available && canPin && (
        <Tappable onPress={onAdd} style={styles.addBtn}>
          <Feather name="plus" size={15} color={C.accentA} />
          <Text style={styles.addBtnTxt}>{count > 0 ? 'Add another' : `Add ${kind === 'today' ? 'Today' : 'Month'}`}</Text>
        </Tappable>
      )}
    </Appear>
  );
}

function Tip({ icon, text, last }: { icon: Icon; text: string; last?: boolean }) {
  return (
    <View style={[styles.tip, !last && styles.tipLine]}>
      <Feather name={icon} size={14} color={C.accentB} style={{ marginTop: 1 }} />
      <Text style={styles.tipTxt}>{text}</Text>
    </View>
  );
}

// ---- Today ------------------------------------------------------------------

type PRow = { kind: 'task'; t: Task; state: 'ahead' | 'now' | 'past' } | { kind: 'now'; min: number } | { kind: 'free'; min: number; live: boolean };

// The same rows the widget draws (modules/widgets/.../TodayWidget.kt).
function todayRows(list: Task[], now: number): PRow[] {
  const out: PRow[] = [];
  const timed = list.filter((t) => t.type === 'planned').sort((a, b) => a.start - b.start || a.dur - b.dur);
  let placed = false;
  let cursor: number | null = null;
  for (const t of timed) {
    const end = t.start + t.dur;
    if (cursor != null && t.start > cursor) {
      if (!placed && now >= cursor && now < t.start) {
        out.push({ kind: 'now', min: now });
        placed = true;
        if (t.start - now >= 30) out.push({ kind: 'free', min: t.start - now, live: true });
      } else if (t.start - cursor >= 30) out.push({ kind: 'free', min: t.start - cursor, live: false });
    }
    if (!placed && now < t.start) {
      out.push({ kind: 'now', min: now });
      placed = true;
    }
    const state = now >= t.start && now < end ? 'now' : end <= now ? 'past' : 'ahead';
    if (state === 'now') placed = true;
    out.push({ kind: 'task', t, state });
    cursor = Math.max(cursor ?? end, end);
  }
  if (!placed && timed.length) out.push({ kind: 'now', min: now });
  return out;
}

function TodayPreview({ tasks, settings }: { tasks: Task[]; settings: Settings }) {
  const d = new Date();
  const key = todayKey();
  const now = d.getHours() * 60 + d.getMinutes();
  const list = useMemo(() => expandRange(tasks, key, key).get(key) ?? [], [tasks, key]);
  const rows = useMemo(() => todayRows(list, now), [list, now]);
  const allDay = list.filter((t) => t.type === 'allday').sort((a, b) => Number(!!b.starred) - Number(!!a.starred));
  const done = list.filter((t) => t.done).length;
  // Around "now", like the widget opens.
  const at = Math.max(
    0,
    rows.findIndex((r) => r.kind === 'now' || (r.kind === 'task' && r.state === 'now'))
  );
  const from = Math.max(0, Math.min(at - 1, rows.length - 5));
  const shown = rows.slice(from, from + 5);
  return (
    <LinearGradient colors={['#17171C', '#0E0E11']} style={styles.widget}>
      <View style={styles.tHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.tDay}>{WEEKDAYS_FULL[d.getDay()]}</Text>
          <Text style={styles.tDate}>
            {MONTHS[d.getMonth()]} {d.getDate()}
          </Text>
        </View>
        {list.length > 0 && <Text style={[styles.tCount, done === list.length && { color: C.accentB }]}>{done === list.length ? 'All done' : `${done} of ${list.length}`}</Text>}
        <LinearGradient colors={[C.accentA, C.accentB]} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={styles.tAdd}>
          <Feather name="plus" size={17} color="#0b0b0d" />
        </LinearGradient>
      </View>
      {list.length > 0 && (
        <View style={styles.tBar}>
          <LinearGradient colors={[C.accentA, C.accentB]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.tBarFill, { width: `${Math.round((done / list.length) * 100)}%` }]} />
        </View>
      )}
      {allDay.length > 0 && (
        <Appear from="up" delay={60} style={styles.tAllDay}>
          <Feather name="sun" size={13} color="#F2C14E" />
          <Text style={styles.tAllDayTxt} numberOfLines={1}>
            {allDay.map((t, i) => (
              <Text key={t.id}>
                {i > 0 && <Text style={{ color: '#5B5B63' }}>{'  ·  '}</Text>}
                <Text style={t.done ? [styles.strike, { color: '#6E6E76' }] : null}>
                  {t.starred ? '★ ' : ''}
                  {t.title}
                </Text>
              </Text>
            ))}
          </Text>
        </Appear>
      )}
      {shown.length === 0 ? (
        <View style={styles.tEmpty}>
          <Text style={styles.tEmptyTitle}>{allDay.length ? 'Nothing at a set time' : 'Nothing planned'}</Text>
          <Text style={styles.tEmptySub}>Tap + to add a task</Text>
        </View>
      ) : (
        <View style={{ marginTop: 6 }}>
          {shown.map((r, i) => (
            <Appear key={r.kind === 'task' ? r.t.id : `${r.kind}-${i}`} from="up" delay={80 + i * 45} distance={8}>
              <PreviewRow r={r} clock={settings.clock} tags={settings} />
            </Appear>
          ))}
        </View>
      )}
    </LinearGradient>
  );
}

function PreviewRow({ r, clock, tags }: { r: PRow; clock: '12h' | '24h'; tags: Settings }) {
  if (r.kind === 'now')
    return (
      <View style={styles.pNow}>
        <Text style={styles.pNowTime}>{fmt(r.min, clock)}</Text>
        <View style={styles.pNowDot} />
        <View style={styles.pNowLine} />
      </View>
    );
  if (r.kind === 'free')
    return (
      <View style={styles.pFree}>
        <View style={styles.pTimeCol} />
        <View style={styles.pFreeBand} />
        <Text style={[styles.pFreeTxt, r.live && { color: C.accentB }]}>
          Free · {fmtDur(r.min)}
          {r.live ? ' left' : ''}
        </Text>
      </View>
    );
  const t = r.t;
  const grey = t.done || r.state === 'past';
  const tag = t.tagId ? tags.tags.find((x) => x.id === t.tagId) : null;
  const sub = [t.type === 'planned' ? fmtDur(t.dur) : 'All day', tag?.name].filter(Boolean).join(' · ');
  return (
    <View style={[styles.pRow, r.state === 'now' && styles.pRowNow]}>
      <View style={styles.pTimeCol}>
        <Text style={[styles.pStart, r.state === 'now' && { color: C.now }, grey && { color: '#6E6E76' }]}>{t.type === 'allday' ? 'All' : fmt(t.start, clock)}</Text>
        <Text style={styles.pEnd}>{t.type === 'allday' ? 'day' : fmt(t.start + t.dur, clock)}</Text>
      </View>
      <View style={[styles.pBand, { backgroundColor: grey ? '#4A4A52' : t.color }]} />
      <Text style={styles.pEmoji}>{t.emoji}</Text>
      <View style={{ flex: 1 }}>
        <Text style={[styles.pTitle, grey && { color: C.muted }, t.done && styles.strike]} numberOfLines={1}>
          {t.starred ? '★ ' : ''}
          {t.title}
        </Text>
        <Text style={styles.pSub} numberOfLines={1}>
          {sub}
        </Text>
      </View>
      {r.state === 'now' && (
        <View style={styles.pBadge}>
          <Text style={styles.pBadgeTxt}>NOW</Text>
        </View>
      )}
      <View style={[styles.pCheck, t.done ? { backgroundColor: r.state === 'past' ? '#6E6E76' : t.color, borderColor: 'transparent' } : null]}>
        {t.done && <Feather name="check" size={11} color="#0b0b0d" />}
      </View>
    </View>
  );
}

// ---- Month ------------------------------------------------------------------

function MonthPreview({ tasks, settings }: { tasks: Task[]; settings: Settings }) {
  const [off, setOff] = useState(0);
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth() + off, 1);
  const monFirst = settings.weekStart === 'mon';
  const lead = monFirst ? (first.getDay() + 6) % 7 : first.getDay();
  const daysIn = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const rows = Math.ceil((lead + daysIn) / 7);
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - lead);
  const from = dateKey(start);
  const to = dateKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + rows * 7 - 1));
  const byDay = useMemo(() => expandRange(tasks, from, to), [tasks, from, to]);
  const tKey = todayKey();
  const letters = monFirst ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'] : ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const todayCol = monFirst ? (today.getDay() + 6) % 7 : today.getDay();
  const go = (n: number) => {
    Haptics.selectionAsync().catch(() => {});
    setOff((o) => Math.max(-24, Math.min(24, o + n)));
  };
  return (
    <LinearGradient colors={['#17171C', '#0E0E11']} style={[styles.widget, { paddingHorizontal: 10 }]}>
      <View style={styles.mHead}>
        <Appear key={`t${off}`} from={off >= 0 ? 'right' : 'left'} distance={10} style={styles.mTitle}>
          <Text style={styles.mMonth}>{MONTHS[first.getMonth()]}</Text>
          <Text style={styles.mYear}>{first.getFullYear()}</Text>
        </Appear>
        {off !== 0 && (
          <Appear from="pop">
            <Tappable onPress={() => setOff(0)} style={styles.mToday}>
              <Text style={styles.mTodayTxt}>Today</Text>
            </Tappable>
          </Appear>
        )}
        <Tappable onPress={() => go(-1)} style={styles.mArrow} hitSlop={6}>
          <Feather name="chevron-left" size={16} color={C.textDim} />
        </Tappable>
        <Tappable onPress={() => go(1)} style={styles.mArrow} hitSlop={6}>
          <Feather name="chevron-right" size={16} color={C.textDim} />
        </Tappable>
      </View>
      <View style={styles.mWeek}>
        {letters.map((l, i) => (
          <Text key={i} style={[styles.mLetter, off === 0 && i === todayCol && { color: C.accentB }]}>
            {l}
          </Text>
        ))}
      </View>
      <Appear key={`g${off}`} from={off >= 0 ? 'right' : 'left'} distance={14}>
        {Array.from({ length: rows }, (_, r) => (
          <View key={r} style={styles.mRow}>
            {Array.from({ length: 7 }, (_, c) => {
              const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + r * 7 + c);
              const k = dateKey(d);
              const inMonth = d.getMonth() === first.getMonth();
              const isToday = k === tKey;
              const past = k < tKey;
              const list = (byDay.get(k) ?? []).slice().sort(widgetOrder);
              const chips = list.slice(0, list.length > 3 ? 2 : 3); // a "+N" line takes the third's place
              return (
                <View key={c} style={[styles.mCell, isToday && styles.mCellToday]}>
                  <View style={[styles.mNum, isToday && styles.mNumToday]}>
                    <Text style={[styles.mNumTxt, isToday ? { color: '#0b0b0d' } : !inMonth ? { color: '#3E3E45' } : past ? { color: '#7A7A82' } : null]}>{d.getDate()}</Text>
                  </View>
                  {chips.map((t) => {
                    const strong = inMonth && !t.done && !past;
                    return (
                      <View key={t.id} style={[styles.mChip, { backgroundColor: hexA(t.color, strong ? 0.44 : inMonth ? 0.22 : 0.13) }]}>
                        <Text style={[styles.mChipTxt, !strong && { color: '#9A9AA2' }, t.done && styles.strike]} numberOfLines={1}>
                          {t.title}
                        </Text>
                      </View>
                    );
                  })}
                  {list.length > 3 && <Text style={styles.mMore}>+{list.length - 2}</Text>}
                </View>
              );
            })}
          </View>
        ))}
      </Appear>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 11, color: C.muted, fontWeight: '700', marginBottom: 9, marginTop: 20, letterSpacing: 0.3 },
  note: { flexDirection: 'row', gap: 9, alignItems: 'flex-start', marginTop: 10, padding: 12, borderRadius: 14, backgroundColor: 'rgba(124,124,240,0.08)' },
  noteTxt: { flex: 1, fontSize: 12.5, color: C.textDim, lineHeight: 17 },
  card: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 4 },
  tip: { flexDirection: 'row', gap: 10, paddingVertical: 10, paddingHorizontal: 2 },
  tipLine: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  tipTxt: { flex: 1, fontSize: 12.5, color: C.textDim, lineHeight: 17 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(124,124,240,0.12)',
    boxShadow: 'inset 0 0 0 1px rgba(124,124,240,0.3)',
  },
  addBtnTxt: { fontSize: 13.5, fontWeight: '800', color: C.accentA },
  onBadge: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  onBadgeTxt: { fontSize: 12.5, fontWeight: '700', color: C.accentB },
  strike: { textDecorationLine: 'line-through' },

  widget: { borderRadius: 24, padding: 12, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1), 0 14px 30px -14px rgba(0,0,0,0.9)' },
  tHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 4 },
  tDay: { fontSize: 17, fontWeight: '800', color: C.text },
  tDate: { fontSize: 12, color: C.muted, marginTop: 2 },
  tCount: { fontSize: 12, fontWeight: '800', color: C.textDim },
  tAdd: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  tBar: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.08)', marginTop: 10, marginHorizontal: 4, overflow: 'hidden' },
  tBarFill: { height: 3, borderRadius: 2 },
  tEmpty: { alignItems: 'center', paddingVertical: 22 },
  tAllDay: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 8, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)' },
  tAllDayTxt: { flex: 1, fontSize: 12.5, color: C.textDim },
  tEmptyTitle: { fontSize: 14, fontWeight: '800', color: C.textDim },
  tEmptySub: { fontSize: 12, color: C.muted, marginTop: 3 },
  pRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingRight: 6, marginVertical: 2, borderRadius: 12, borderWidth: 1, borderColor: 'transparent' },
  pRowNow: { backgroundColor: 'rgba(255,90,95,0.08)', borderColor: 'rgba(255,90,95,0.28)' },
  pTimeCol: { width: 46, alignItems: 'flex-end' },
  pStart: { fontSize: 12.5, fontWeight: '800', color: C.textDim, fontVariant: ['tabular-nums'] },
  pEnd: { fontSize: 10.5, color: '#6E6E76', marginTop: 2, fontVariant: ['tabular-nums'] },
  pBand: { width: 4, height: 34, borderRadius: 2, marginHorizontal: 9 },
  pEmoji: { fontSize: 17, marginRight: 8 },
  pTitle: { fontSize: 14, fontWeight: '800', color: C.text },
  pSub: { fontSize: 11, color: C.muted, marginTop: 3 },
  pBadge: { marginLeft: 6, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6, backgroundColor: 'rgba(255,90,95,0.15)' },
  pBadgeTxt: { fontSize: 9, fontWeight: '900', color: C.now },
  pCheck: { width: 19, height: 19, borderRadius: 10, borderWidth: 2, borderColor: '#5B5B63', marginLeft: 8, alignItems: 'center', justifyContent: 'center' },
  pNow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3 },
  pNowTime: { width: 46, textAlign: 'right', fontSize: 10.5, fontWeight: '800', color: C.now, fontVariant: ['tabular-nums'] },
  pNowDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: C.now, marginLeft: 6.5 },
  pNowLine: { flex: 1, height: 1.5, backgroundColor: 'rgba(255,90,95,0.8)', marginRight: 6 },
  pFree: { flexDirection: 'row', alignItems: 'center', paddingVertical: 1 },
  pFreeBand: { width: 2, height: 22, marginHorizontal: 10, borderLeftWidth: 2, borderStyle: 'dashed', borderColor: '#3A3A42' },
  pFreeTxt: { fontSize: 11, color: '#6E6E76' },

  mHead: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 4, paddingBottom: 6 },
  mTitle: { flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  mMonth: { fontSize: 16, fontWeight: '800', color: C.text },
  mYear: { fontSize: 13, color: C.muted },
  mToday: { paddingHorizontal: 10, height: 26, borderRadius: 13, backgroundColor: 'rgba(79,209,197,0.14)', justifyContent: 'center', marginRight: 4 },
  mTodayTxt: { fontSize: 11.5, fontWeight: '800', color: C.accentB },
  mArrow: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.07)', alignItems: 'center', justifyContent: 'center' },
  mWeek: { flexDirection: 'row', paddingBottom: 3 },
  mLetter: { flex: 1, textAlign: 'center', fontSize: 10, fontWeight: '800', color: '#6E6E76' },
  mRow: { flexDirection: 'row', height: 70 },
  mCell: { flex: 1, paddingHorizontal: 1.5, paddingTop: 2, borderRadius: 8 },
  mCellToday: { backgroundColor: 'rgba(255,255,255,0.06)', boxShadow: 'inset 0 0 0 1px rgba(79,209,197,0.2)' },
  mNum: { alignSelf: 'center', width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  mNumToday: { backgroundColor: C.accentB },
  mNumTxt: { fontSize: 11, fontWeight: '800', color: '#E4E4E8' },
  mChip: { marginTop: 1.5, borderRadius: 4, paddingHorizontal: 3, paddingVertical: 1 },
  mChipTxt: { fontSize: 8.5, color: C.text },
  mMore: { fontSize: 8.5, fontWeight: '800', color: C.muted, textAlign: 'center', marginTop: 1 },
});
