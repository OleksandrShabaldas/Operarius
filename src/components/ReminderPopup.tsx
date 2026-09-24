import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import * as Native from '../../modules/reminders';
import { C } from '../theme';
import { ms, sp } from '../motion';
import { useApp } from '../store';
import { Clock, CustomReminder, Draft, Reminders, TaskType } from '../types';
import { dateHint, dateLabel, fmt, hexA } from '../utils';
import {
  blankReminders,
  fmtOffset,
  fromNow,
  hasReminders,
  hasTime,
  localMs,
  newCustom,
  OFFSETS,
  taskWindow,
} from '../reminders';
import { BottomSheet } from './Overlay';
import { MonthCalendar, TimeWheels, Wheel, WheelDeck } from './pickers';
import { Toggle } from './MotionSettings';
import { CheckList, INTENSITY, IntensityPicker, reminderChecks, useReminderStatus } from './ReminderBits';
import { Appear, Tappable } from './anim';

// ---------------------------------------------------------------------------
// The task's reminders: before it starts, after it ends, and any number of
// custom moments — plus how insistent they are.
// ---------------------------------------------------------------------------
export function ReminderPopup({
  visible,
  draft,
  onChange,
  onClose,
}: {
  visible: boolean;
  draft: Draft | null;
  onChange: (r: Reminders | null) => void;
  onClose: () => void;
}) {
  const { settings } = useApp();
  const { height: winH } = useWindowDimensions();
  const [page, setPage] = useState<'main' | 'custom'>('main');
  const [edit, setEdit] = useState<{ c: CustomReminder; isNew: boolean } | null>(null);
  const { status, refresh } = useReminderStatus(visible);
  const asked = useRef(false);

  useEffect(() => {
    if (visible) {
      setPage('main');
      setEdit(null);
    }
  }, [visible]);

  // Keep the last draft through the close animation.
  const dRef = useRef<Draft | null>(draft);
  if (draft) dRef.current = draft;
  const d = draft ?? dRef.current;

  const cur: Reminders = d?.reminders ?? blankReminders(settings);
  const timed = d ? hasTime(d.type) : false;
  const win = d ? taskWindow(d, settings) : null;
  const on = hasReminders(cur);
  const count = (timed ? (cur.before != null ? 1 : 0) + (cur.after != null ? 1 : 0) : 0) + cur.custom.length;

  const set = (patch: Partial<Reminders>) => {
    const next = { ...cur, ...patch };
    // The first reminder is the moment to ask for notifications (Android 13+).
    if (!on && hasReminders(next) && !asked.current) {
      asked.current = true;
      Native.requestNotifications().then(refresh);
    }
    onChange(next);
  };

  const openCustom = (c: CustomReminder | null) => {
    if (!d) return;
    setEdit(c ? { c: { ...c }, isNew: false } : { c: newCustom(d, settings), isNew: true });
    setPage('custom');
  };
  const saveCustom = () => {
    if (!edit) return;
    const list = edit.isNew ? [...cur.custom, edit.c] : cur.custom.map((x) => (x.id === edit.c.id ? edit.c : x));
    set({ custom: list });
    setPage('main');
  };
  const removeCustom = (id: string) => set({ custom: cur.custom.filter((x) => x.id !== id) });

  const sorted = [...cur.custom].sort((a, b) => localMs(a.date, a.min) - localMs(b.date, b.min));
  const checks = status && on ? reminderChecks(status, { screen: cur.intensity !== 'easy', ring: cur.intensity === 'intense' }) : [];

  return (
    <BottomSheet open={visible} onClose={onClose}>
      {d && page === 'main' && (
        <Appear key="main" from="left" distance={14}>
          <ScrollView style={{ maxHeight: winH * 0.78 }} showsVerticalScrollIndicator={false} bounces={false} keyboardShouldPersistTaps="handled">
            <View style={styles.head}>
              <Text style={styles.title}>Reminders</Text>
              <CountPill n={count} color={INTENSITY[cur.intensity].color} />
            </View>
            <View style={styles.ctx}>
              <View style={[styles.ctxDot, { backgroundColor: d.color }]} />
              <Text style={styles.ctxTxt} numberOfLines={1}>
                {[d.title.trim() || 'New task', contextTime(d.type, d.start, d.dur, d.date, settings.clock)].filter(Boolean).join('  ·  ')}
              </Text>
            </View>

            {timed ? (
              <View style={styles.edges}>
                <EdgeCard kind="before" type={d.type} value={cur.before} win={win} date={d.date} repeating={!!d.repeat} clock={settings.clock} onChange={(v) => set({ before: v })} delay={40} />
                <EdgeCard kind="after" type={d.type} value={cur.after} win={win} date={d.date} repeating={!!d.repeat} clock={settings.clock} onChange={(v) => set({ after: v })} delay={90} />
              </View>
            ) : (
              <Appear from="up" delay={40} style={styles.todoNote}>
                <Feather name="info" size={14} color={C.muted} />
                <Text style={styles.todoNoteTxt}>To-dos have no set time, so remind yourself at a moment you pick below.</Text>
              </Appear>
            )}

            <SectionLabel icon="calendar" text="CUSTOM TIME & DATE" />
            {sorted.length === 0 ? (
              <Appear from="up" delay={120}>
                <Tappable onPress={() => openCustom(null)} style={styles.addBig}>
                  <View style={styles.addIcon}>
                    <Feather name="plus" size={17} color={C.accentB} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.addTitle}>Custom time and date</Text>
                    <Text style={styles.addSub}>Remind me at a moment I pick</Text>
                  </View>
                  <Feather name="chevron-right" size={18} color={C.muted} />
                </Tappable>
              </Appear>
            ) : (
              <>
                {sorted.map((c, i) => (
                  <Appear key={c.id} from="up" delay={60 + i * 35} distance={8}>
                    <CustomRow c={c} clock={settings.clock} onEdit={() => openCustom(c)} onRemove={() => removeCustom(c.id)} />
                  </Appear>
                ))}
                <Tappable onPress={() => openCustom(null)} style={styles.addAnother} hitSlop={8}>
                  <Feather name="plus" size={13} color={C.accentA} />
                  <Text style={styles.addAnotherTxt}>Add another reminder</Text>
                </Tappable>
              </>
            )}

            <SectionLabel icon="activity" text="INTENSITY" />
            <IntensityPicker value={cur.intensity} onChange={(v) => set({ intensity: v })} />

            {checks.some((c) => !c.ok && c.level !== 'tip') && (
              <>
                <SectionLabel icon="shield" text="SO IT ARRIVES ON TIME" />
                <CheckList checks={checks} onFixed={refresh} />
              </>
            )}

            <View style={styles.footer}>
              {on && (
                <Tappable onPress={() => onChange(null)} style={styles.offBtn}>
                  <Feather name="bell-off" size={15} color={C.danger} />
                  <Text style={styles.offTxt}>Turn off</Text>
                </Tappable>
              )}
              <Tappable onPress={onClose} style={styles.doneBtn}>
                <Text style={styles.doneTxt}>Done</Text>
              </Tappable>
            </View>
          </ScrollView>
        </Appear>
      )}

      {d && page === 'custom' && edit && (
        <Appear key="custom" from="right" distance={14}>
          <ScrollView style={{ maxHeight: winH * 0.8 }} showsVerticalScrollIndicator={false} bounces={false}>
            <CustomPage
              edit={edit}
              clock={settings.clock}
              weekStart={settings.weekStart}
              onChange={(c) => setEdit({ ...edit, c })}
              onBack={() => setPage('main')}
              onSave={saveCustom}
              onDelete={() => {
                removeCustom(edit.c.id);
                setPage('main');
              }}
            />
          </ScrollView>
        </Appear>
      )}
    </BottomSheet>
  );
}

// "11:30 – 12:00 · Today" / "All day · Tomorrow" / "To-do"
function contextTime(type: TaskType, start: number, dur: number, date: string | null, clock: Clock): string {
  if (type === 'todo') return 'To-do';
  const day = dateLabel(date);
  return type === 'planned' ? `${fmt(start, clock)} – ${fmt(start + dur, clock)} · ${day}` : `All day · ${day}`;
}

// A springy pill with how many reminders are on.
function CountPill({ n, color }: { n: number; color: string }) {
  const s = useSharedValue(1);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    s.value = 0.8;
    s.value = withSpring(1, sp({ damping: 9, stiffness: 320 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n]);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <Animated.View style={[styles.count, { backgroundColor: n ? hexA(color, 0.15) : 'rgba(255,255,255,0.06)' }, a]}>
      <Feather name={n ? 'bell' : 'bell-off'} size={12} color={n ? color : C.muted} />
      <Text style={[styles.countTxt, { color: n ? color : C.muted }]}>{n ? `${n} on` : 'Off'}</Text>
    </Animated.View>
  );
}

function SectionLabel({ icon, text }: { icon: keyof typeof Feather.glyphMap; text: string }) {
  return (
    <View style={styles.section}>
      <Feather name={icon} size={12} color={C.muted} />
      <Text style={styles.sectionTxt}>{text}</Text>
      <View style={styles.sectionLine} />
    </View>
  );
}

// "Before start" / "After end": a switch and a compact drum of offsets. The
// drum stays visible (dimmed) while off — scrolling it switches it on.
function EdgeCard({
  kind,
  type,
  value,
  win,
  date,
  repeating,
  clock,
  onChange,
  delay,
}: {
  kind: 'before' | 'after';
  type: TaskType;
  value: number | null;
  win: { start: number; end: number } | null;
  date: string | null;
  repeating: boolean;
  clock: Clock;
  onChange: (v: number | null) => void;
  delay: number;
}) {
  const on = value != null;
  const [last, setLast] = useState(value ?? 0);
  useEffect(() => {
    if (value != null) setLast(value);
  }, [value]);
  const shown = value ?? last;
  let idx = 0;
  OFFSETS.forEach((o, i) => {
    if (Math.abs(o - shown) < Math.abs(OFFSETS[idx] - shown)) idx = i;
  });

  const dim = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    dim.value = withTiming(on ? 1 : 0, { duration: ms(220) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);
  const wheelStyle = useAnimatedStyle(() => ({ opacity: 0.35 + 0.65 * dim.value }));

  const edge = kind === 'before' ? (type === 'allday' ? 'Day start' : 'Start') : type === 'allday' ? 'Day end' : 'End';
  const fireMin = win ? (kind === 'before' ? win.start - shown : win.end + shown) : null;
  const at = date && fireMin != null ? localMs(date, fireMin) : null;
  const passed = on && !repeating && at != null && at <= Date.now();
  const dayShift = fireMin == null ? '' : fireMin < 0 ? ' · day before' : fireMin >= 1440 ? ' · next day' : '';
  const zero = kind === 'before' ? 'At start' : 'At end';

  return (
    <Appear from="up" delay={delay} style={{ flex: 1 }}>
      <View style={[styles.edge, on && styles.edgeOn]}>
        <View style={styles.edgeHead}>
          <Feather name={kind === 'before' ? 'skip-back' : 'skip-forward'} size={13} color={on ? C.accentB : C.muted} />
          <Text style={[styles.edgeTitle, on && { color: C.text }]} numberOfLines={1}>
            {kind === 'before' ? 'Before' : 'After'}
          </Text>
          <Toggle value={on} onChange={(v) => onChange(v ? last : null)} />
        </View>
        <Animated.View style={wheelStyle}>
          <WheelDeck rows={3}>
            <Wheel rows={3} values={OFFSETS} index={idx} width={124} fontSize={18} format={(v) => (v === 0 ? zero : fmtOffset(v))} onIndex={(i) => onChange(OFFSETS[i])} />
          </WheelDeck>
        </Animated.View>
        <Text style={[styles.edgeAt, passed && { color: C.danger }]} numberOfLines={1}>
          {fireMin == null ? '' : passed ? `Passed · ${fmt(fireMin, clock)}` : `${edge === 'Start' || edge === 'End' ? '' : edge + ' · '}${fmt(fireMin, clock)}${dayShift}`}
        </Text>
      </View>
    </Appear>
  );
}

function CustomRow({ c, clock, onEdit, onRemove }: { c: CustomReminder; clock: Clock; onEdit: () => void; onRemove: () => void }) {
  const at = localMs(c.date, c.min);
  const past = at <= Date.now();
  return (
    <Tappable onPress={onEdit} style={styles.cRow}>
      <View style={[styles.cIcon, past && { backgroundColor: 'rgba(248,103,122,0.12)' }]}>
        <Feather name={past ? 'alert-circle' : 'bell'} size={15} color={past ? C.danger : C.accentB} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.cTitle, past && { color: C.muted }]}>
          {dateLabel(c.date)} · {fmt(c.min, clock)}
        </Text>
        <Text style={[styles.cSub, past && { color: C.danger }]}>{past ? 'Already passed — won’t ring' : [dateHint(c.date), fromNow(at)].filter(Boolean).join('  ·  ')}</Text>
      </View>
      <Tappable onPress={onRemove} hitSlop={10} style={styles.cX}>
        <Feather name="x" size={16} color={C.faint} />
      </Tappable>
    </Tappable>
  );
}

// Pick a day and a time for a custom reminder.
function CustomPage({
  edit,
  clock,
  weekStart,
  onChange,
  onBack,
  onSave,
  onDelete,
}: {
  edit: { c: CustomReminder; isNew: boolean };
  clock: Clock;
  weekStart: 'mon' | 'sun';
  onChange: (c: CustomReminder) => void;
  onBack: () => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const { c } = edit;
  const at = localMs(c.date, c.min);
  const past = at <= Date.now();
  return (
    <>
      <View style={styles.pageHead}>
        <Tappable onPress={onBack} hitSlop={8} style={styles.pageBack}>
          <Feather name="chevron-left" size={21} color={C.textDim} />
        </Tappable>
        <Text style={styles.pageTitle}>{edit.isNew ? 'New reminder' : 'Edit reminder'}</Text>
      </View>
      <Appear from="up" delay={30}>
        <MonthCalendar value={c.date} weekStart={weekStart} onChange={(key) => onChange({ ...c, date: key })} />
      </Appear>
      <Appear from="up" delay={80} style={{ marginTop: 12 }}>
        <TimeWheels value={c.min} clock={clock} max={24 * 60 - 5} onChange={(min) => onChange({ ...c, min })} />
      </Appear>
      <Appear from="up" delay={120}>
        <View style={[styles.when, past && styles.whenBad]}>
          <Feather name={past ? 'alert-circle' : 'bell'} size={15} color={past ? C.danger : C.accentB} />
          <Text style={[styles.whenTxt, past && { color: C.danger }]}>
            {past ? 'That moment has passed — pick a later one' : `${dateLabel(c.date)} at ${fmt(c.min, clock)} · ${fromNow(at)}`}
          </Text>
        </View>
      </Appear>
      <View style={styles.footer}>
        {!edit.isNew && (
          <Tappable onPress={onDelete} style={styles.delBtn}>
            <Feather name="trash-2" size={18} color={C.danger} />
          </Tappable>
        )}
        <Tappable onPress={onSave} disabled={past} style={[styles.saveBtn, past && { opacity: 0.4 }]}>
          <Text style={styles.saveTxt}>{edit.isNew ? 'Add reminder' : 'Save'}</Text>
        </Tappable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 19, fontWeight: '700', color: C.text },
  count: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, height: 28, borderRadius: 14 },
  countTxt: { fontSize: 12.5, fontWeight: '800' },
  ctx: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, marginBottom: 16 },
  ctxDot: { width: 8, height: 8, borderRadius: 4 },
  ctxTxt: { flex: 1, fontSize: 13, fontWeight: '600', color: C.muted, fontVariant: ['tabular-nums'] },

  edges: { flexDirection: 'row', gap: 10 },
  edge: { borderRadius: 18, padding: 10, paddingTop: 12, backgroundColor: 'rgba(255,255,255,0.035)', boxShadow: 'inset 0 0 0 1px rgba(79,209,197,0)' },
  edgeOn: { backgroundColor: 'rgba(79,209,197,0.06)', boxShadow: 'inset 0 0 0 1px rgba(79,209,197,0.28)' },
  edgeHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10, paddingLeft: 4 },
  edgeTitle: { flex: 1, fontSize: 14, fontWeight: '800', color: C.textDim },
  edgeAt: { fontSize: 12, fontWeight: '700', color: C.muted, textAlign: 'center', marginTop: 8, fontVariant: ['tabular-nums'] },

  todoNote: { flexDirection: 'row', gap: 9, alignItems: 'flex-start', padding: 13, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.04)' },
  todoNoteTxt: { flex: 1, fontSize: 13, color: C.textDim, lineHeight: 18 },

  section: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 20, marginBottom: 10 },
  sectionTxt: { fontSize: 11, color: C.muted, fontWeight: '800', letterSpacing: 0.6 },
  sectionLine: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.07)', marginLeft: 3 },

  addBig: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(79,209,197,0.35)', backgroundColor: 'rgba(79,209,197,0.04)' },
  addIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: 'rgba(79,209,197,0.14)', alignItems: 'center', justifyContent: 'center' },
  addTitle: { fontSize: 15, fontWeight: '700', color: C.text },
  addSub: { fontSize: 12, color: C.muted, marginTop: 2 },
  addAnother: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 4, marginTop: 2 },
  addAnotherTxt: { fontSize: 13, fontWeight: '700', color: C.accentA },

  cRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 11, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', marginBottom: 8 },
  cIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: 'rgba(79,209,197,0.12)', alignItems: 'center', justifyContent: 'center' },
  cTitle: { fontSize: 15, fontWeight: '700', color: C.text, fontVariant: ['tabular-nums'] },
  cSub: { fontSize: 12, fontWeight: '600', color: C.muted, marginTop: 2 },
  cX: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },

  footer: { flexDirection: 'row', gap: 10, marginTop: 20 },
  offBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 16, height: 50, borderRadius: 15, backgroundColor: 'rgba(248,103,122,0.12)' },
  offTxt: { fontSize: 14.5, fontWeight: '700', color: C.danger },
  doneBtn: { flex: 1, height: 50, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  doneTxt: { fontSize: 15, fontWeight: '700', color: C.text },

  pageHead: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 12, marginLeft: -6 },
  pageBack: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  pageTitle: { fontSize: 18, fontWeight: '700', color: C.text },
  when: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 12, paddingHorizontal: 13, paddingVertical: 12, borderRadius: 14, backgroundColor: 'rgba(79,209,197,0.08)' },
  whenBad: { backgroundColor: 'rgba(248,103,122,0.08)' },
  whenTxt: { flex: 1, fontSize: 13.5, fontWeight: '700', color: C.accentB, fontVariant: ['tabular-nums'] },
  delBtn: { width: 54, height: 50, borderRadius: 15, backgroundColor: 'rgba(248,103,122,0.12)', alignItems: 'center', justifyContent: 'center' },
  saveBtn: { flex: 1, height: 50, borderRadius: 15, backgroundColor: C.accentB, alignItems: 'center', justifyContent: 'center' },
  saveTxt: { fontSize: 15, fontWeight: '800', color: '#0b0b0d' },
});
