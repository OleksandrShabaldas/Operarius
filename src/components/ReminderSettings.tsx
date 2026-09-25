import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import * as Native from '../../modules/reminders';
import type { NativeReminder } from '../../modules/reminders';
import { C } from '../theme';
import { useApp } from '../store';
import { ReminderIntensity, Tag } from '../types';
import { fmt, hexA } from '../utils';
import { afterLabel, beforeLabel, buildSchedule, fmtOffset, intensityFor, localMs, whenLabel } from '../reminders';
import { CenterPopup } from './Overlay';
import { Toggle } from './MotionSettings';
import { CheckList, INTENSITIES, INTENSITY, IntensityPicker, reminderChecks, useReminderStatus } from './ReminderBits';
import { Appear, Tappable } from './anim';
import { sp } from '../motion';

const BEFORE_CHOICES: (number | null)[] = [null, 0, 5, 10, 15, 30, 60];
const SNOOZE_CHOICES = [5, 10, 15, 20, 30];
const RING_CHOICES = [1, 5, 10, 15, 30, 0];
const DAY = 86400000;
const TEST_DELAY = 5; // seconds

// ---------------------------------------------------------------------------
// Settings → Reminders.
// ---------------------------------------------------------------------------
export function ReminderSettings() {
  const { tasks, settings, updateSettings, setTagIntensity } = useApp();
  const [tagPick, setTagPick] = useState<string | null>(null);
  // Tags in order: each top-level tag followed by its sub-tags.
  const tagRows = useMemo(() => {
    const out: Tag[] = [];
    for (const t of settings.tags.filter((x) => !x.parentId)) {
      out.push(t);
      out.push(...settings.tags.filter((x) => x.parentId === t.id));
    }
    return out;
  }, [settings.tags]);
  const picked = tagPick ? settings.tags.find((t) => t.id === tagPick) ?? null : null;
  const pickedParent = picked?.parentId ? settings.tags.find((t) => t.id === picked.parentId) ?? null : null;
  // What a tag gets when it has none of its own: its parent's, or the default.
  const inherited = (t: Tag) => intensityFor(settings, t.parentId ?? null);
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
      subsLeft: 0,
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

      {/* Per tag */}
      {tagRows.length > 0 && (
        <>
          <Text style={styles.section}>BY TAG</Text>
          <View style={[styles.card, { paddingVertical: 2 }]}>
            {tagRows.map((t, i) => {
              const own = t.intensity;
              const eff = own ?? inherited(t);
              const parent = t.parentId ? settings.tags.find((x) => x.id === t.parentId) : null;
              const m = INTENSITY[eff];
              return (
                <Appear key={t.id} from="up" delay={30 + i * 22} distance={6}>
                  <Tappable
                    onPress={() => setTagPick(t.id)}
                    scaleTo={0.98}
                    style={[styles.tagRow, !!t.parentId && styles.tagRowSub, i < tagRows.length - 1 && styles.tagRowLine]}>
                    {t.parentId ? (
                      <View style={[styles.subDot, { borderColor: t.color }]}>{!!t.icon && <Text style={styles.subIcon}>{t.icon}</Text>}</View>
                    ) : (
                      <View style={[styles.tagDot, { backgroundColor: t.color }]} />
                    )}
                    <Text style={[styles.tagName, !!t.parentId && { fontWeight: '600', color: C.textDim }]} numberOfLines={1}>
                      {t.name}
                    </Text>
                    {own ? (
                      <View style={[styles.tagVal, { backgroundColor: hexA(m.color, 0.14) }]}>
                        <Feather name={m.icon} size={12} color={m.color} />
                        <Text style={[styles.tagValTxt, { color: m.color }]}>{m.label}</Text>
                      </View>
                    ) : (
                      <Text style={styles.tagInherit} numberOfLines={1}>
                        {parent ? `Like ${parent.name}` : 'Default'} · {m.label}
                      </Text>
                    )}
                    <Feather name="chevron-right" size={16} color={C.faint} />
                  </Tappable>
                </Appear>
              );
            })}
          </View>
          <Text style={styles.hint}>Reminders of a task with the tag start this way. A sub-tag follows its tag unless it has its own.</Text>
        </>
      )}

      <CenterPopup open={!!picked} onClose={() => setTagPick(null)}>
        {picked && (
          <>
            <View style={styles.popHead}>
              <View style={[styles.popDot, { backgroundColor: picked.color }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.popTitle} numberOfLines={1}>
                  {picked.name}
                </Text>
                <Text style={styles.popSub}>{pickedParent ? `Sub-tag of ${pickedParent.name}` : 'Reminders of its tasks start as…'}</Text>
              </View>
            </View>
            <Tappable
              onPress={() => setTagIntensity(picked.id, null)}
              scaleTo={0.98}
              style={[styles.inheritRow, !picked.intensity && { backgroundColor: 'rgba(79,209,197,0.1)', boxShadow: 'inset 0 0 0 1px rgba(79,209,197,0.4)' }]}>
              <View style={[styles.radio, { borderColor: !picked.intensity ? C.accentB : 'rgba(255,255,255,0.25)' }]}>{!picked.intensity && <Appear from="pop" style={styles.radioDot} />}</View>
              <View style={{ flex: 1 }}>
                <Text style={styles.inheritTitle}>{pickedParent ? `Like ${pickedParent.name}` : 'The default'}</Text>
                <Text style={styles.inheritSub}>
                  {INTENSITY[inherited(picked)].label} — {pickedParent ? 'follows its tag' : 'as set for new tasks above'}
                </Text>
              </View>
            </Tappable>
            <Text style={[styles.label, { marginTop: 14 }]}>Or its own</Text>
            <IntensityPicker value={picked.intensity ?? inherited(picked)} onChange={(v) => setTagIntensity(picked.id, v)} />
            <Tappable style={styles.popDone} onPress={() => setTagPick(null)}>
              <Text style={styles.popDoneTxt}>Done</Text>
            </Tappable>
          </>
        )}
      </CenterPopup>

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

      {/* The full-screen reminder's buttons */}
      <Text style={styles.section}>ON THE FULL-SCREEN REMINDER</Text>
      <View style={[styles.card, { paddingVertical: 4 }]}>
        <ButtonsPreview snooze={settings.alarmSnoozeBtn} done={settings.alarmDoneBtn} snoozeMin={settings.snoozeMin} />
        <View style={[styles.divider, { marginLeft: 0 }]} />
        <View style={styles.optRow}>
          <View style={styles.optIcon}>
            <Feather name="clock" size={15} color={C.accentB} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.optTitle}>Snooze button</Text>
            <Text style={styles.optSub}>{settings.alarmSnoozeBtn ? `Snoozes for ${settings.snoozeMin} min` : 'Hidden'}</Text>
          </View>
          <Toggle value={settings.alarmSnoozeBtn} onChange={(v) => updateSettings({ alarmSnoozeBtn: v })} />
        </View>
        <View style={styles.divider} />
        <View style={styles.optRow}>
          <View style={styles.optIcon}>
            <Feather name="check" size={15} color={C.accentB} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.optTitle}>Done button</Text>
            <Text style={styles.optSub}>{settings.alarmDoneBtn ? 'Ticks the task off' : 'Hidden'}</Text>
          </View>
          <Toggle value={settings.alarmDoneBtn} onChange={(v) => updateSettings({ alarmDoneBtn: v })} />
        </View>
      </View>
      <Text style={styles.hint}>The reminder can always be slid away, and “Open task” below it opens the task.</Text>

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

// The reminder's button row as it will look: a switched-off button folds away
// and the other takes the room; the slider is always there.
function ButtonsPreview({ snooze, done, snoozeMin }: { snooze: boolean; done: boolean; snoozeMin: number }) {
  const a = useSharedValue(snooze ? 1 : 0);
  const b = useSharedValue(done ? 1 : 0);
  useEffect(() => {
    a.value = withSpring(snooze ? 1 : 0, sp({ damping: 18, stiffness: 220 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snooze]);
  useEffect(() => {
    b.value = withSpring(done ? 1 : 0, sp({ damping: 18, stiffness: 220 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);
  const row = useAnimatedStyle(() => ({ height: 40 * Math.min(1, Math.max(a.value, b.value)) + 0.01, marginBottom: 8 * Math.min(1, Math.max(a.value, b.value)) }));
  const left = useAnimatedStyle(() => ({ flex: Math.max(0.0001, a.value), opacity: a.value, transform: [{ scale: 0.8 + 0.2 * a.value }] }));
  const right = useAnimatedStyle(() => ({ flex: Math.max(0.0001, b.value), opacity: b.value, marginLeft: 8 * Math.min(a.value, b.value), transform: [{ scale: 0.8 + 0.2 * b.value }] }));
  return (
    <View style={styles.pv}>
      <Animated.View style={[styles.pvRow, row]}>
        <Animated.View style={[styles.pvBtn, left]}>
          <Feather name="clock" size={13} color={C.textDim} />
          <Text style={styles.pvBtnTxt} numberOfLines={1}>
            Snooze {snoozeMin} min
          </Text>
        </Animated.View>
        <Animated.View style={[styles.pvBtn, right]}>
          <Feather name="check" size={13} color={C.accentB} />
          <Text style={styles.pvBtnTxt} numberOfLines={1}>
            Done
          </Text>
        </Animated.View>
      </Animated.View>
      <View style={styles.pvSlider}>
        <View style={styles.pvKnob}>
          <Feather name="chevrons-right" size={14} color="#0b0b0d" />
        </View>
        <Text style={styles.pvSliderTxt}>Slide to dismiss</Text>
      </View>
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
  pv: { paddingVertical: 12, paddingHorizontal: 2 },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 2 },
  tagRowSub: { paddingLeft: 22 },
  tagRowLine: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  tagDot: { width: 12, height: 12, borderRadius: 6 },
  subDot: { width: 18, height: 18, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  subIcon: { fontSize: 10 },
  tagName: { flex: 1, fontSize: 14.5, fontWeight: '700', color: C.text },
  tagVal: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, height: 26, borderRadius: 9 },
  tagValTxt: { fontSize: 12, fontWeight: '800' },
  tagInherit: { flexShrink: 1, fontSize: 12.5, fontWeight: '600', color: C.muted },
  popHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  popDot: { width: 16, height: 16, borderRadius: 8 },
  popTitle: { fontSize: 17, fontWeight: '800', color: C.text },
  popSub: { fontSize: 12.5, color: C.muted, marginTop: 2 },
  inheritRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.04)' },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.accentB },
  inheritTitle: { fontSize: 14.5, fontWeight: '800', color: C.text },
  inheritSub: { fontSize: 12, color: C.muted, marginTop: 2 },
  popDone: { height: 48, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  popDoneTxt: { fontSize: 15, fontWeight: '700', color: C.text },
  pvRow: { flexDirection: 'row', overflow: 'hidden' },
  pvBtn: { height: 40, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.07)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1)' },
  pvBtnTxt: { fontSize: 12.5, fontWeight: '800', color: C.text },
  pvSlider: { height: 40, borderRadius: 20, flexDirection: 'row', alignItems: 'center', padding: 4, backgroundColor: 'rgba(255,255,255,0.05)' },
  pvKnob: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: C.accentB },
  pvSliderTxt: { flex: 1, textAlign: 'center', marginRight: 32, fontSize: 12.5, fontWeight: '700', color: C.muted },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16 },
  summaryOk: { backgroundColor: 'rgba(79,209,197,0.08)', boxShadow: 'inset 0 0 0 1px rgba(79,209,197,0.25)' },
  summaryWarn: { backgroundColor: 'rgba(245,161,92,0.08)', boxShadow: 'inset 0 0 0 1px rgba(245,161,92,0.3)' },
  summaryTitle: { fontSize: 15, fontWeight: '800', color: C.text },
  summarySub: { fontSize: 12.5, color: C.textDim, marginTop: 2, lineHeight: 17 },
  tests: { flexDirection: 'row', gap: 8 },
  testBtn: { flex: 1, height: 50, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  testTxt: { fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'], paddingRight: 1 },
});
