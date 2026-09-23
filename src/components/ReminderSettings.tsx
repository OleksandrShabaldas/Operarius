import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import * as Native from '../../modules/reminders';
import type { NativeReminder } from '../../modules/reminders';
import { C } from '../theme';
import { useApp } from '../store';
import { ReminderIntensity } from '../types';
import { fmt, hexA } from '../utils';
import { afterLabel, beforeLabel, buildSchedule, fmtOffset, localMs, whenLabel } from '../reminders';
import { Toggle } from './MotionSettings';
import { CheckList, INTENSITIES, INTENSITY, IntensityPicker, reminderChecks, useReminderStatus } from './ReminderBits';
import { Appear, Tappable } from './anim';

const BEFORE_CHOICES: (number | null)[] = [null, 0, 5, 10, 15, 30, 60];
const SNOOZE_CHOICES = [5, 10, 15, 20, 30];
const RING_CHOICES = [1, 5, 10, 15, 30, 0];
const DAY = 86400000;
const TEST_DELAY = 5; // seconds

// ---------------------------------------------------------------------------
// Settings → Reminders.
// ---------------------------------------------------------------------------
export function ReminderSettings() {
  const { tasks, settings, updateSettings } = useApp();
  const { status, refresh } = useReminderStatus();
  const [soundName, setSoundName] = useState<string>(settings.alarmSound?.name ?? 'Default alarm');
  const [testing, setTesting] = useState<{ kind: ReminderIntensity; until: number } | null>(null);
  const [, tick] = useState(0);

  // The name of the phone's default alarm sound ("Default (Cesium)").
  useEffect(() => {
    if (settings.alarmSound) setSoundName(settings.alarmSound.name);
    else Native.soundName(null).then(setSoundName);
  }, [settings.alarmSound]);

  // Test countdown.
  useEffect(() => {
    if (!testing) return;
    const t = setInterval(() => {
      if (Date.now() > testing.until + 1500) setTesting(null);
      else tick((n) => n + 1);
    }, 250);
    return () => clearInterval(t);
  }, [testing]);

  const now = Date.now();
  const schedule = useMemo(() => buildSchedule(tasks, { ...settings, remindersOn: true }), [tasks, settings]);
  const week = schedule.filter((r) => r.at < now + 7 * DAY).length;
  const next = schedule.slice(0, 3);

  // Every intensity can be picked for any task, so all checks count here.
  const checks = status ? reminderChecks(status, { screen: true, ring: true }) : [];
  const problems = checks.filter((c) => !c.ok && c.level !== 'tip');

  const runTest = async (kind: ReminderIntensity) => {
    const up = tasks
      .filter((t) => t.type === 'planned' && !t.done && t.date && localMs(t.date, t.start) > Date.now())
      .sort((a, b) => localMs(a.date!, a.start) - localMs(b.date!, b.start))[0];
    const startAt = Date.now() + TEST_DELAY * 1000 + 10 * 60000;
    const endAt = startAt + (up?.dur ?? 30) * 60000;
    const m = (ms: number) => {
      const d = new Date(ms);
      return d.getHours() * 60 + d.getMinutes();
    };
    const sample: NativeReminder = {
      id: 'test',
      taskKey: '__test',
      date: null,
      at: 0,
      wall: null,
      intensity: kind,
      kind: 'before',
      title: up?.title ?? 'Stretch & drink some water',
      emoji: up?.emoji ?? '🧘',
      color: up?.color ?? '#4FD1C5',
      startAt,
      endAt,
      timeText: `${fmt(m(startAt), settings.clock)} – ${fmt(m(endAt), settings.clock)}`,
      detail: 'A test — nothing is changed',
    };
    await Native.test(sample, TEST_DELAY);
    setTesting({ kind, until: Date.now() + TEST_DELAY * 1000 });
  };

  const pickSound = async () => {
    const r = await Native.pickSound(settings.alarmSound?.uri ?? null);
    if (r) updateSettings({ alarmSound: r.uri ? { uri: r.uri, name: r.name } : null });
  };

  return (
    <View style={{ marginTop: 10 }}>
      {/* Master switch */}
      <Appear from="up" delay={20} style={styles.master}>
        <View style={[styles.masterIcon, !settings.remindersOn && { backgroundColor: 'rgba(255,255,255,0.06)' }]}>
          <Feather name={settings.remindersOn ? 'bell' : 'bell-off'} size={17} color={settings.remindersOn ? C.accentB : C.muted} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.masterTitle}>Reminders</Text>
          <Text style={styles.masterSub}>
            {!settings.remindersOn ? 'Paused — nothing will notify or ring' : week ? `${week} coming up in the next 7 days` : 'On — add them from a task’s editor'}
          </Text>
        </View>
        <Toggle value={settings.remindersOn} onChange={(v) => updateSettings({ remindersOn: v })} />
      </Appear>

      {!Native.available && (
        <Appear from="up" delay={50} style={styles.webNote}>
          <Feather name="smartphone" size={14} color={C.muted} />
          <Text style={styles.webNoteTxt}>Reminders ring in the Android app. Everything you set here is kept with your tasks.</Text>
        </Appear>
      )}

      {/* Next up */}
      <Text style={styles.section}>NEXT UP</Text>
      <View style={[styles.card, !settings.remindersOn && { opacity: 0.5 }]}>
        {next.length === 0 ? (
          <Text style={styles.empty}>Nothing scheduled — set reminders from a task’s editor.</Text>
        ) : (
          next.map((r, i) => <NextRow key={r.id} r={r} clock={settings.clock} delay={60 + i * 40} last={i === next.length - 1} />)
        )}
      </View>

      {/* Defaults for new tasks */}
      <Text style={styles.section}>NEW TASKS</Text>
      <Text style={styles.label}>Remind me before a task starts</Text>
      <Chips
        items={BEFORE_CHOICES}
        value={settings.reminderDefault.before}
        format={(v) => (v == null ? 'Off' : v === 0 ? 'At start' : fmtOffset(v))}
        onPick={(v) => updateSettings({ reminderDefault: { ...settings.reminderDefault, before: v } })}
      />
      <Text style={[styles.label, { marginTop: 14 }]}>Intensity</Text>
      <IntensityPicker value={settings.reminderDefault.intensity} onChange={(v) => updateSettings({ reminderDefault: { ...settings.reminderDefault, intensity: v } })} />
      <Text style={styles.hint}>Used for tasks you create from now on — each task can change it in its Reminders.</Text>

      {/* Alarms */}
      <Text style={styles.section}>WHEN IT RINGS</Text>
      <Text style={styles.label}>Snooze for</Text>
      <Chips items={SNOOZE_CHOICES} value={settings.snoozeMin} format={(v) => `${v} min`} onPick={(v) => updateSettings({ snoozeMin: v })} />
      <Text style={[styles.label, { marginTop: 14 }]}>Intense alarms ring for</Text>
      <Chips items={RING_CHOICES} value={settings.ringMin} format={(v) => (v === 0 ? 'Until dismissed' : `${v} min`)} onPick={(v) => updateSettings({ ringMin: v })} />
      <View style={[styles.card, { marginTop: 14, paddingVertical: 4 }]}>
        <Tappable onPress={pickSound} disabled={!Native.available} style={[styles.optRow, !Native.available && { opacity: 0.5 }]}>
          <View style={styles.optIcon}>
            <Feather name="music" size={15} color={C.accentB} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.optTitle}>Alarm sound</Text>
            <Text style={styles.optSub} numberOfLines={1}>
              {soundName}
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color={C.muted} />
        </Tappable>
        <View style={styles.divider} />
        <View style={styles.optRow}>
          <View style={styles.optIcon}>
            <Feather name="activity" size={15} color={C.accentB} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.optTitle}>Vibrate in pulses</Text>
            <Text style={styles.optSub}>{settings.alarmVibrate ? 'Three strong pulses, again and again' : 'Sound only'}</Text>
          </View>
          <Toggle value={settings.alarmVibrate} onChange={(v) => updateSettings({ alarmVibrate: v })} />
        </View>
        <View style={styles.divider} />
        <View style={styles.optRow}>
          <View style={styles.optIcon}>
            <Feather name="trending-up" size={15} color={C.accentB} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.optTitle}>Gentle start</Text>
            <Text style={styles.optSub}>{settings.alarmGentle ? 'Fades in over 30 seconds' : 'Starts at full volume'}</Text>
          </View>
          <Toggle value={settings.alarmGentle} onChange={(v) => updateSettings({ alarmGentle: v })} />
        </View>
      </View>
      <Text style={styles.hint}>Press a volume key on the reminder screen to silence the alarm but keep the reminder up.</Text>

      {/* Reliability */}
      {Native.available && status && (
        <>
          <Text style={styles.section}>RELIABILITY</Text>
          <Appear from="up" delay={40}>
            <View style={[styles.summary, problems.length ? styles.summaryWarn : styles.summaryOk]}>
              <Feather name={problems.length ? 'alert-triangle' : 'shield'} size={18} color={problems.length ? '#f5a15c' : C.accentB} />
              <View style={{ flex: 1 }}>
                <Text style={styles.summaryTitle}>{problems.length ? `${problems.length} thing${problems.length > 1 ? 's' : ''} to fix` : 'All set'}</Text>
                <Text style={styles.summarySub}>{problems.length ? 'Fix these so reminders arrive on time, even when the phone is asleep.' : 'Reminders will arrive on time — through Doze, restarts and battery saving.'}</Text>
              </View>
            </View>
          </Appear>
          <View style={{ marginTop: 10 }}>
            <CheckList checks={checks} showOk onFixed={refresh} />
          </View>
        </>
      )}

      {/* Try it */}
      {Native.available && (
        <>
          <Text style={styles.section}>TRY IT</Text>
          <Text style={styles.hint2}>Sends a test in {TEST_DELAY} seconds — lock the phone to see the lock-screen version.</Text>
          <View style={styles.tests}>
            {INTENSITIES.map((k) => {
              const m = INTENSITY[k];
              const active = testing?.kind === k;
              const left = active ? Math.max(0, Math.ceil((testing!.until - Date.now()) / 1000)) : 0;
              return (
                <Tappable key={k} onPress={() => runTest(k)} style={[styles.testBtn, { backgroundColor: hexA(m.color, active ? 0.22 : 0.1), boxShadow: `inset 0 0 0 1px ${hexA(m.color, active ? 0.6 : 0.25)}` }]}>
                  <Feather name={m.icon} size={16} color={m.color} />
                  <Text style={[styles.testTxt, { color: m.color }]}>{active ? (left > 0 ? `in ${left}…` : 'Now!') : m.label}</Text>
                </Tappable>
              );
            })}
          </View>
        </>
      )}
    </View>
  );
}

function NextRow({ r, clock, delay, last }: { r: NativeReminder; clock: '12h' | '24h'; delay: number; last: boolean }) {
  const m = INTENSITY[r.intensity];
  const what = r.kind === 'before' ? beforeLabel(Math.round((r.startAt - r.at) / 60000)) : r.kind === 'after' ? afterLabel(Math.round((r.at - r.endAt) / 60000)) : 'At a set time';
  return (
    <Appear from="up" delay={delay} distance={8}>
      <View style={[styles.nextRow, !last && styles.nextRowLine]}>
        <LinearGradient colors={[r.color, hexA(r.color, 0.72)]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={styles.nextIcon}>
          <Text style={styles.nextEmoji}>{r.emoji}</Text>
        </LinearGradient>
        <View style={{ flex: 1 }}>
          <Text style={styles.nextTitle} numberOfLines={1}>
            {r.title}
          </Text>
          <View style={styles.nextMeta}>
            <View style={[styles.nextDot, { backgroundColor: m.color }]} />
            <Text style={styles.nextSub} numberOfLines={1}>
              {what}
            </Text>
          </View>
        </View>
        <Text style={styles.nextWhen}>{whenLabel(r.at, clock)}</Text>
      </View>
    </Appear>
  );
}

function Chips<T extends number | null>({ items, value, format, onPick }: { items: T[]; value: T; format: (v: T) => string; onPick: (v: T) => void }) {
  return (
    <View style={styles.chips}>
      {items.map((v, i) => {
        const on = v === value;
        return (
          <Appear key={String(v)} from="up" delay={20 + i * 18} distance={6}>
            <Tappable onPress={() => onPick(v)} style={[styles.chip, on && styles.chipOn]} scaleTo={0.92}>
              <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{format(v)}</Text>
            </Tappable>
          </Appear>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  master: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 14 },
  masterIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(79,209,197,0.12)', alignItems: 'center', justifyContent: 'center' },
  masterTitle: { fontSize: 15.5, fontWeight: '700', color: C.text },
  masterSub: { fontSize: 12.5, color: C.muted, marginTop: 2 },
  webNote: { flexDirection: 'row', gap: 9, alignItems: 'flex-start', marginTop: 10, padding: 12, borderRadius: 14, backgroundColor: 'rgba(124,124,240,0.08)' },
  webNoteTxt: { flex: 1, fontSize: 12.5, color: C.textDim, lineHeight: 17 },
  section: { fontSize: 11, color: C.muted, fontWeight: '700', marginBottom: 9, marginTop: 20, letterSpacing: 0.3 },
  label: { fontSize: 13, color: C.textDim, fontWeight: '600', marginBottom: 8 },
  hint: { fontSize: 12, color: C.muted, lineHeight: 17, marginTop: 10 },
  hint2: { fontSize: 12, color: C.muted, lineHeight: 17, marginBottom: 10 },
  card: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  empty: { color: C.faint, fontSize: 13, paddingVertical: 12, textAlign: 'center' },
  nextRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 10 },
  nextRowLine: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  nextIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  nextEmoji: { fontSize: 16 },
  nextTitle: { fontSize: 14.5, fontWeight: '700', color: C.text },
  nextMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  nextDot: { width: 6, height: 6, borderRadius: 3 },
  nextSub: { flexShrink: 1, fontSize: 12, color: C.muted, fontWeight: '600' },
  nextWhen: { fontSize: 12.5, fontWeight: '700', color: C.textDim, fontVariant: ['tabular-nums'], paddingRight: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)' },
  chipOn: { backgroundColor: C.accentB },
  chipTxt: { fontSize: 13, fontWeight: '700', color: C.textDim },
  chipTxtOn: { color: '#0b0b0d' },
  optRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 },
  optIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(79,209,197,0.1)', alignItems: 'center', justifyContent: 'center' },
  optTitle: { fontSize: 14.5, fontWeight: '700', color: C.text },
  optSub: { fontSize: 12, color: C.muted, marginTop: 2 },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginLeft: 44 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16 },
  summaryOk: { backgroundColor: 'rgba(79,209,197,0.08)', boxShadow: 'inset 0 0 0 1px rgba(79,209,197,0.25)' },
  summaryWarn: { backgroundColor: 'rgba(245,161,92,0.08)', boxShadow: 'inset 0 0 0 1px rgba(245,161,92,0.3)' },
  summaryTitle: { fontSize: 15, fontWeight: '800', color: C.text },
  summarySub: { fontSize: 12.5, color: C.textDim, marginTop: 2, lineHeight: 17 },
  tests: { flexDirection: 'row', gap: 8 },
  testBtn: { flex: 1, height: 50, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  testTxt: { fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'], paddingRight: 1 },
});
