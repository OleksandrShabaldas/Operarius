import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, Linking, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  FadeOut,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import * as Cal from '../../modules/calendar';
import type { DeviceCalendar } from '../../modules/calendar';
import { C } from '../theme';
import { motion, ms, sp } from '../motion';
import { useApp } from '../store';
import { CalDirection, CalExtra } from '../types';
import { dateLabel, dateKey, fmt, hexA } from '../utils';
import { AHEAD_DAYS, applySwitch, CAL_EMOJI, PAST_DAYS, planSwitch, requestCalendarSync, useCalendarStatus } from '../calendarSync';
import { Toggle } from './MotionSettings';
import { CenterPopup } from './Overlay';
import { Appear, stagger, Tappable } from './anim';

type Icon = keyof typeof Feather.glyphMap;

const DIRS: { id: CalDirection; label: string; icon: Icon; title: string; blurb: string; feats: string[] }[] = [
  {
    id: 'both',
    label: 'Both ways',
    icon: 'repeat',
    title: 'Tasks and events stay in step',
    blurb: 'Change either side and the other follows — the task wins if both changed.',
    feats: ['Tasks → calendar', 'Events → tasks', 'Deletes follow'],
  },
  {
    id: 'toCalendar',
    label: 'To calendar',
    icon: 'arrow-right',
    title: 'Your tasks show in the calendar',
    blurb: 'The calendar mirrors your tasks. Edits made there are replaced by the task’s own.',
    feats: ['Tasks → calendar', 'Its events stay out'],
  },
  {
    id: 'fromCalendar',
    label: 'From calendar',
    icon: 'arrow-left',
    title: 'Events come in as tasks',
    blurb: 'Tasks follow every change made in the calendar. Nothing is written to it.',
    feats: ['Events → tasks', 'Calendar untouched'],
  },
];

// "just now" / "5 min ago" / "2 h ago" / "Yesterday 18:40"
function ago(at: number, clock: '12h' | '24h', now = Date.now()): string {
  const m = Math.floor((now - at) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 12) return `${h} h ago`;
  const d = new Date(at);
  return `${dateLabel(dateKey(d))} ${fmt(d.getHours() * 60 + d.getMinutes(), clock)}`;
}

const isGoogle = (c: DeviceCalendar) => c.accountType === 'com.google';
const isLocal = (c: DeviceCalendar) => c.accountType === 'LOCAL';

// The calendar a first-time switch-on lands on: the Google account's own.
function bestCalendar(list: DeviceCalendar[]): DeviceCalendar | null {
  return list.find((c) => isGoogle(c) && c.primary && c.writable) ?? list.find((c) => isGoogle(c) && c.writable) ?? list.find((c) => c.writable) ?? list[0] ?? null;
}

// ---------------------------------------------------------------------------
// Settings → Google Calendar.
// ---------------------------------------------------------------------------
export function CalendarSettings() {
  const { tasks, settings, updateCalendar, applyCalendarSync } = useApp();
  const cfg = settings.calendar;
  const status = useCalendarStatus();
  const [perm, setPerm] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [cals, setCals] = useState<DeviceCalendar[] | null>(null);
  // Stopping syncing a calendar: what happens to its tasks (and, for the main one, where new tasks go next).
  const [confirm, setConfirm] = useState<{ drop: DeviceCalendar; moving: number; leaving: number; next: CalExtra | null } | null>(null);
  const [mainNote, setMainNote] = useState(0); // the main calendar tapped while it's the only one
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    if (!Cal.available) return;
    const p = await Cal.permission();
    setPerm(p);
    if (p === 'granted') setCals(await Cal.calendars());
  }, []);

  // On open, and when coming back from the phone's settings (an account added,
  // access granted).
  useEffect(() => {
    load();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && load());
    const t = setInterval(() => tick((n) => n + 1), 30000); // "5 min ago" stays true
    return () => {
      sub.remove();
      clearInterval(t);
    };
  }, [load]);

  const current = cals?.find((c) => c.id === cfg.calendarId) ?? null;
  const readOnly = !!current && !current.writable;
  const synced = (c: DeviceCalendar) => c.id === cfg.calendarId || cfg.extra.some((e) => e.id === c.id);
  const syncedCals = cals?.filter(synced) ?? [];
  const counts = cfg.extra.reduce((n, e) => ({ toCalendar: n.toCalendar + e.counts.toCalendar, fromCalendar: n.fromCalendar + e.counts.fromCalendar }), cfg.counts);

  const groups = useMemo(() => {
    if (!cals) return [];
    const by = new Map<string, DeviceCalendar[]>();
    for (const c of cals) {
      const k = isLocal(c) ? '\u0000local' : `${isGoogle(c) ? 0 : 1}${c.account}`;
      by.set(k, [...(by.get(k) ?? []), c]);
    }
    return [...by.entries()]
      .sort(([a], [b]) => (a.startsWith('\u0000') ? 1 : b.startsWith('\u0000') ? -1 : a.localeCompare(b)))
      .map(([k, list]) => ({
        key: k,
        title: k === '\u0000local' ? 'On this phone only' : list[0].account,
        google: isGoogle(list[0]),
        list: [...list].sort((a, b) => Number(b.primary) - Number(a.primary) || Number(b.writable) - Number(a.writable) || a.name.localeCompare(b.name)),
      }));
  }, [cals]);

  const setOn = async (v: boolean) => {
    if (!Cal.available) return;
    Haptics.selectionAsync().catch(() => {});
    if (!v) {
      updateCalendar({ on: false });
      return;
    }
    const ok = await Cal.requestPermission();
    setPerm(ok ? 'granted' : 'denied');
    if (!ok) return;
    const list = await Cal.calendars();
    setCals(list);
    const cur = list.find((c) => c.id === cfg.calendarId);
    const pick = cur ?? bestCalendar(list);
    if (!pick) {
      updateCalendar({ on: true, calendarId: null, lastError: null });
      return;
    }
    updateCalendar({
      on: true,
      calendarId: pick.id,
      calendarName: pick.name,
      account: pick.account,
      color: pick.color,
      direction: pick.writable ? cfg.direction : 'fromCalendar',
      lastError: null,
      ...(cur ? {} : { seen: [], ignored: [] }),
    });
  };

  const grant = async () => {
    const ok = await Cal.requestPermission();
    setPerm(ok ? 'granted' : 'denied');
    if (ok) {
      setCals(await Cal.calendars());
      requestCalendarSync({ refresh: true });
    } else Linking.openSettings().catch(() => {});
  };

  // The main calendar's state, as one of the others (and back).
  const asExtra = (): CalExtra => ({ id: cfg.calendarId!, name: cfg.calendarName, account: cfg.account, color: cfg.color, seen: cfg.seen, ignored: cfg.ignored, counts: cfg.counts });
  const asMain = (e: CalExtra, writable: boolean) => ({
    calendarId: e.id,
    calendarName: e.name,
    account: e.account,
    color: e.color,
    seen: e.seen,
    ignored: e.ignored,
    counts: e.counts,
    direction: writable ? cfg.direction : ('fromCalendar' as CalDirection),
  });
  const writableId = (id: string) => !!cals?.find((c) => c.id === id)?.writable;

  // New tasks go to another synced calendar (the old main one keeps syncing, as one of the others).
  const makeMain = (c: DeviceCalendar) => {
    if (c.id === cfg.calendarId || !cfg.calendarId) return;
    const e = cfg.extra.find((x) => x.id === c.id);
    if (!e) return;
    Haptics.selectionAsync().catch(() => {});
    updateCalendar({ ...asMain(e, c.writable), extra: [...cfg.extra.filter((x) => x.id !== c.id), asExtra()], lastError: null });
  };

  // No longer syncing one: the app's own events there move to the main
  // calendar, tasks brought in from it leave (their events stay there).
  const doDrop = async (c: DeviceCalendar, next: CalExtra | null) => {
    const ops = await applySwitch(planSwitch(tasks, c.id), c.writable && cfg.direction !== 'fromCalendar');
    if (c.id !== cfg.calendarId) applyCalendarSync(ops, { extra: cfg.extra.filter((e) => e.id !== c.id) });
    else if (next) applyCalendarSync(ops, { ...asMain(next, writableId(next.id)), extra: cfg.extra.filter((e) => e.id !== next.id), lastError: null });
  };

  // A calendar tapped: synced too — or, when it is, no longer (asking first when it has tasks here).
  const toggle = (c: DeviceCalendar) => {
    if (!synced(c)) {
      Haptics.selectionAsync().catch(() => {});
      updateCalendar({ extra: [...cfg.extra, { id: c.id, name: c.name, account: c.account, color: c.color, seen: [], ignored: [], counts: { toCalendar: 0, fromCalendar: 0 } }] });
      return;
    }
    const isMain = c.id === cfg.calendarId;
    // The main one hands over to another (a writable one if there is), or stays if it's the only one.
    const next = isMain ? (cfg.extra.find((e) => writableId(e.id)) ?? cfg.extra[0] ?? null) : null;
    if (isMain && !next) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      setMainNote((n) => n + 1);
      return;
    }
    Haptics.selectionAsync().catch(() => {});
    const plan = planSwitch(tasks, c.id);
    if (plan.moving.length || plan.leaving.length || isMain) setConfirm({ drop: c, moving: plan.moving.length, leaving: plan.leaving.length, next });
    else doDrop(c, next);
  };

  const setDir = (d: CalDirection) => {
    if (d === cfg.direction) return;
    if (readOnly && d !== 'fromCalendar') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      return;
    }
    Haptics.selectionAsync().catch(() => {});
    updateCalendar({ direction: d });
  };

  const on = Cal.available && cfg.on;
  const denied = on && perm === 'denied';
  const sub = !Cal.available
    ? 'Works in the Android app'
    : !cfg.on
      ? 'Off — tasks stay in Operarius only'
      : denied
        ? 'Needs access to your calendar'
        : status.busy
          ? 'Syncing…'
          : cfg.lastError
            ? 'Paused — see below'
            : cfg.lastSync
              ? `${cfg.calendarName || 'Calendar'}${cfg.extra.length ? ` + ${cfg.extra.length} more` : ''} · synced ${ago(cfg.lastSync, settings.clock)}`
              : cfg.calendarId
                ? `${cfg.calendarName} · starting…`
                : 'Pick a calendar below';

  return (
    <View style={{ marginTop: 10 }}>
      {/* Master switch */}
      <Appear from="up" delay={20} style={styles.master}>
        <View style={[styles.masterIcon, on ? { backgroundColor: hexA(cfg.color || C.accentB, 0.16) } : { backgroundColor: 'rgba(255,255,255,0.06)' }]}>
          <Feather name="calendar" size={17} color={on ? cfg.color || C.accentB : C.muted} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.masterTitle}>Google Calendar</Text>
          <Appear key={sub} from="up" distance={5}>
            <Text style={[styles.masterSub, on && cfg.lastError && !status.busy && { color: '#f5a15c' }]} numberOfLines={1}>
              {sub}
            </Text>
          </Appear>
        </View>
        <Toggle value={on} onChange={setOn} />
      </Appear>

      {/* Off: what it does, and one tap to start */}
      {!on && (
        <Animated.View entering={stagger(1)} exiting={FadeOut.duration(ms(150))} style={styles.intro}>
          <View style={styles.introArt}>
            <FlowMock dir="both" color="#5B9DF9" />
          </View>
          <Text style={styles.introTitle}>Your plan and your calendar, together</Text>
          <IntroLine icon="upload-cloud" text="Tasks show up in Google Calendar — on the web and on every device" delay={80} />
          <IntroLine icon="download-cloud" text="Meetings and events from the calendar come in as tasks" delay={120} />
          <IntroLine icon="sliders" text="Choose how it syncs: both ways, or just one way" delay={160} />
          {Cal.available && (
            <Appear from="up" delay={200}>
              <Tappable onPress={() => setOn(true)} style={styles.introBtn}>
                <Feather name="refresh-cw" size={15} color="#0b0b0d" />
                <Text style={styles.introBtnTxt}>Turn on sync</Text>
              </Tappable>
            </Appear>
          )}
        </Animated.View>
      )}

      {!Cal.available && (
        <Appear from="up" delay={50} style={styles.note}>
          <Feather name="smartphone" size={14} color={C.muted} />
          <Text style={styles.noteTxt}>Calendar sync runs in the Android app, through the Google account on your phone.</Text>
        </Appear>
      )}

      {on && denied && (
        <Animated.View entering={stagger(0)} exiting={FadeOut.duration(ms(150))} style={[styles.banner, styles.bannerWarn]}>
          <Feather name="lock" size={17} color="#f5a15c" />
          <View style={{ flex: 1 }}>
            <Text style={styles.bannerTitle}>Calendar access is off</Text>
            <Text style={styles.bannerSub}>Operarius needs to read and write your calendar to sync. Nothing else on your phone is touched.</Text>
            <Tappable onPress={grant} style={[styles.bannerBtn, { backgroundColor: hexA('#f5a15c', 0.16) }]}>
              <Text style={[styles.bannerBtnTxt, { color: '#f5a15c' }]}>Allow access</Text>
            </Tappable>
          </View>
        </Animated.View>
      )}

      {on && !denied && (
        <Animated.View entering={stagger(0)} exiting={FadeOut.duration(ms(150))}>
          {/* A removal waiting for a yes */}
          {status.held && (
            <Animated.View entering={stagger(0)} exiting={FadeOut.duration(ms(150))} style={[styles.banner, styles.bannerWarn]}>
              <Feather name="alert-triangle" size={17} color="#f5a15c" />
              <View style={{ flex: 1 }}>
                <Text style={styles.bannerTitle}>
                  {status.held.count} events are gone from {status.held.cal || cfg.calendarName}
                </Text>
                <Text style={styles.bannerSub}>
                  {status.held.titles.map((t) => `“${t}”`).join(', ')}
                  {status.held.count > status.held.titles.length ? ` and ${status.held.count - status.held.titles.length} more` : ''} were deleted there. Remove their tasks here too?
                </Text>
                <View style={styles.bannerBtns}>
                  <Tappable onPress={() => requestCalendarSync({ mass: 'keep' })} style={[styles.bannerBtn, { backgroundColor: 'rgba(255,255,255,0.08)' }]}>
                    <Text style={styles.bannerBtnTxt}>Keep tasks</Text>
                  </Tappable>
                  <Tappable onPress={() => requestCalendarSync({ mass: 'remove' })} style={[styles.bannerBtn, { backgroundColor: hexA(C.danger, 0.16) }]}>
                    <Text style={[styles.bannerBtnTxt, { color: C.danger }]}>Remove</Text>
                  </Tappable>
                </View>
              </View>
            </Animated.View>
          )}

          {/* Status */}
          <Text style={styles.section}>STATUS</Text>
          <Appear from="up" delay={40} style={styles.card}>
            <View style={styles.statRow}>
              <Stat value={counts.toCalendar} label={`task${counts.toCalendar === 1 ? '' : 's'} in ${cfg.extra.length ? 'calendars' : 'the calendar'}`} color={C.accentB} />
              <View style={styles.statSep} />
              <Stat value={counts.fromCalendar} label={`event${counts.fromCalendar === 1 ? '' : 's'} brought in`} color={cfg.color || C.accentA} />
            </View>
            <View style={styles.divider} />
            <View style={styles.syncRow}>
              <View style={{ flex: 1 }}>
                <Appear key={status.busy ? 'busy' : (cfg.lastError ?? String(cfg.lastSync))} from="up" distance={5}>
                  {cfg.lastError && !status.busy ? (
                    <Text style={styles.syncErr}>{cfg.lastError}</Text>
                  ) : (
                    <Text style={styles.syncWhen}>{status.busy ? 'Syncing…' : cfg.lastSync ? `Synced ${ago(cfg.lastSync, settings.clock)}` : 'Not synced yet'}</Text>
                  )}
                </Appear>
                {!!status.last && !status.busy && !cfg.lastError && status.last.toCalendar + status.last.fromCalendar + status.last.removed > 0 && (
                  <Appear key={`${cfg.lastSync}`} from="up" distance={5}>
                    <Text style={styles.syncLast}>{lastLine(status.last)}</Text>
                  </Appear>
                )}
              </View>
              <SyncButton busy={status.busy} onPress={() => requestCalendarSync({ refresh: true })} />
            </View>
          </Appear>

          {/* Calendars: any number synced; the main one gets the new tasks */}
          <Text style={styles.section}>CALENDARS</Text>
          {cals == null ? (
            <Appear from="up" delay={60} style={[styles.card, styles.loading]}>
              <Text style={styles.empty}>Looking for calendars…</Text>
            </Appear>
          ) : cals.length === 0 ? (
            <Appear from="up" delay={60} style={styles.card}>
              <View style={styles.emptyBox}>
                <Feather name="user-plus" size={22} color={C.muted} />
                <Text style={styles.emptyTitle}>No calendars on this phone yet</Text>
                <Text style={styles.emptySub}>Add your Google account in the phone’s settings (Passwords & accounts) and turn on Calendar sync for it — it’ll show up here.</Text>
                <Tappable onPress={() => Linking.sendIntent('android.settings.ADD_ACCOUNT_SETTINGS').catch(() => Linking.openSettings())} style={styles.linkBtn}>
                  <Feather name="plus" size={14} color={C.accentB} />
                  <Text style={styles.linkBtnTxt}>Add an account</Text>
                </Tappable>
              </View>
            </Appear>
          ) : (
            groups.map((g, gi) => (
              <Appear key={g.key} from="up" delay={60 + gi * 50} style={[styles.card, gi > 0 && { marginTop: 10 }]}>
                <View style={styles.groupHead}>
                  <Feather name={g.google ? 'user' : 'smartphone'} size={12} color={C.muted} />
                  <Text style={styles.groupTitle} numberOfLines={1}>
                    {g.title}
                  </Text>
                  {!g.google && g.key === '\u0000local' && <Text style={styles.groupNote}>not synced to Google</Text>}
                </View>
                {g.list.map((c, i) => (
                  <CalRow key={c.id} c={c} on={synced(c)} main={c.id === cfg.calendarId && cfg.extra.length > 0} delay={90 + gi * 50 + i * 30} last={i === g.list.length - 1} onPress={() => toggle(c)} />
                ))}
              </Appear>
            ))
          )}
          {!!cals?.length && (
            <Appear key={`n-${mainNote}`} from="up" style={styles.note}>
              <Feather name={mainNote ? 'info' : 'layers'} size={14} color={mainNote ? '#f5a15c' : C.muted} />
              <Text style={styles.noteTxt}>
                {mainNote
                  ? 'It’s the only calendar synced — to stop syncing, turn sync off above.'
                  : 'Tap calendars to sync them too: events from each come in as tasks, and edits go back where they came from.'}
              </Text>
            </Appear>
          )}

          {/* Where new tasks go, once there's a choice */}
          {syncedCals.length > 1 && (
            <>
              <Text style={styles.section}>NEW TASKS GO TO</Text>
              <Appear from="up" delay={40} style={styles.mainRow}>
                {syncedCals.map((c) => {
                  const on = c.id === cfg.calendarId;
                  return (
                    <Tappable key={c.id} disabled={!c.writable} onPress={() => makeMain(c)} scaleTo={0.95} style={[styles.mainChip, on && { backgroundColor: hexA(c.color, 0.16), boxShadow: `inset 0 0 0 1.5px ${hexA(c.color, 0.55)}` }, !c.writable && { opacity: 0.4 }]}>
                      <View style={[styles.mainDot, { backgroundColor: c.color }]} />
                      <Text style={[styles.mainTxt, on && { color: C.text }]} numberOfLines={1}>
                        {c.name}
                      </Text>
                      {on && (
                        <Appear from="pop">
                          <Feather name="check" size={13} color={c.color} />
                        </Appear>
                      )}
                    </Tappable>
                  );
                })}
              </Appear>
            </>
          )}

          {current && !isGoogle(current) && (
            <Appear key={`ng-${current.id}`} from="up" style={styles.note}>
              <Feather name="info" size={14} color={C.muted} />
              <Text style={styles.noteTxt}>
                {isLocal(current) ? 'This calendar lives on this phone only.' : `This calendar belongs to ${current.account}.`} Pick one under your Google account to see tasks in Google Calendar.
              </Text>
            </Appear>
          )}

          {/* Direction */}
          <Text style={styles.section}>SYNC</Text>
          <DirectionPicker value={cfg.direction} readOnly={readOnly} color={cfg.color || C.accentA} onChange={setDir} />
          {readOnly && (
            <Appear key={`ro-${current?.id}`} from="up" style={styles.note}>
              <Feather name="lock" size={14} color={C.muted} />
              <Text style={styles.noteTxt}>“{current?.name}” is read-only, so its events can only come in.</Text>
            </Appear>
          )}

          {/* What syncs */}
          <Text style={styles.section}>WHAT SYNCS</Text>
          <Appear from="up" delay={40} style={styles.card}>
            <Legend icon="check-square" text={`Planned and all-day tasks from ${PAST_DAYS} days ago on — repeating ones with their schedule.`} />
            <Legend icon="calendar" text={`Events from ${PAST_DAYS} days back to ${Math.round(AHEAD_DAYS / 30)} months ahead come in as ${CAL_EMOJI} tasks; a repeating event as one task per day.`} />
            <Legend icon="lock" text="To-dos, subtasks, ticks, tags, places and reminders stay in Operarius." />
            <Legend icon="cloud" text="Google gets changes when the phone syncs your account — usually within a minute." last />
          </Appear>
          <Tappable onPress={() => Linking.sendIntent('android.settings.SYNC_SETTINGS').catch(() => Linking.openSettings())} style={styles.linkRow}>
            <Feather name="settings" size={14} color={C.accentB} />
            <Text style={styles.linkBtnTxt}>Phone account sync settings</Text>
            <Feather name="external-link" size={13} color={C.muted} />
          </Tappable>
        </Animated.View>
      )}

      {/* Switching calendars */}
      <CenterPopup open={!!confirm} onClose={() => setConfirm(null)}>
        {confirm && (
          <>
            <Appear from="pop" style={[styles.popIcon, { backgroundColor: hexA(confirm.drop.color, 0.16) }]}>
              <Feather name="calendar" size={22} color={confirm.drop.color} />
            </Appear>
            <Text style={styles.popTitle}>Stop syncing “{confirm.drop.name}”?</Text>
            <View style={{ gap: 8, marginTop: 4 }}>
              {!!confirm.next && (
                <Appear from="up" delay={40} style={styles.popLine}>
                  <Feather name="inbox" size={14} color={C.accentB} />
                  <Text style={styles.popLineTxt}>New tasks go to “{confirm.next.name}” from now on.</Text>
                </Appear>
              )}
              {confirm.moving > 0 && (
                <Appear from="up" delay={60} style={styles.popLine}>
                  <Feather name="arrow-right" size={14} color={C.accentB} />
                  <Text style={styles.popLineTxt}>
                    {confirm.moving} task{confirm.moving === 1 ? '' : 's'} move{confirm.moving === 1 ? 's' : ''} from “{confirm.drop.name}” to “{confirm.next?.name ?? cfg.calendarName}”.
                  </Text>
                </Appear>
              )}
              {confirm.leaving > 0 && (
                <Appear from="up" delay={100} style={styles.popLine}>
                  <Feather name="minus-circle" size={14} color={C.danger} />
                  <Text style={styles.popLineTxt}>
                    {confirm.leaving} task{confirm.leaving === 1 ? '' : 's'} brought in from “{confirm.drop.name}” {confirm.leaving === 1 ? 'is' : 'are'} removed here (the events stay there).
                  </Text>
                </Appear>
              )}
            </View>
            <View style={styles.popBtns}>
              <Tappable style={styles.popCancel} onPress={() => setConfirm(null)}>
                <Text style={styles.popCancelTxt}>Cancel</Text>
              </Tappable>
              <Tappable
                style={[styles.popOk, { backgroundColor: confirm.drop.color }]}
                onPress={() => {
                  const { drop, next } = confirm;
                  setConfirm(null);
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                  doDrop(drop, next);
                }}>
                <Text style={styles.popOkTxt}>Stop syncing</Text>
              </Tappable>
            </View>
          </>
        )}
      </CenterPopup>
    </View>
  );
}

function IntroLine({ icon, text, delay }: { icon: Icon; text: string; delay: number }) {
  return (
    <Appear from="up" delay={delay} distance={8} style={styles.introLine}>
      <View style={styles.introIcon}>
        <Feather name={icon} size={14} color={C.accentB} />
      </View>
      <Text style={styles.introTxt}>{text}</Text>
    </Appear>
  );
}

function lastLine(c: { toCalendar: number; fromCalendar: number; removed: number }): string {
  const parts: string[] = [];
  if (c.toCalendar) parts.push(`${c.toCalendar} sent`);
  if (c.fromCalendar) parts.push(`${c.fromCalendar} brought in`);
  if (c.removed) parts.push(`${c.removed} removed`);
  return `Last time: ${parts.join(' · ')}`;
}

function Stat({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <View style={styles.stat}>
      <Appear key={value} from="up" distance={6}>
        <Text style={[styles.statVal, { color }]}>{value}</Text>
      </Appear>
      <Text style={styles.statLabel} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

// "Sync now", with its arrows turning while a sync runs.
function SyncButton({ busy, onPress }: { busy: boolean; onPress: () => void }) {
  const r = useSharedValue(0);
  useEffect(() => {
    cancelAnimation(r);
    if (busy && motion.enabled) {
      r.value = 0;
      r.value = withRepeat(withTiming(1, { duration: ms(900), easing: Easing.linear }), -1, false);
    } else r.value = withSpring(Math.ceil(r.value), sp({ damping: 16, stiffness: 180 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.value * 360}deg` }] }));
  return (
    <Tappable onPress={onPress} disabled={busy} style={[styles.syncBtn, busy && { opacity: 0.6 }]}>
      <Animated.View style={spin}>
        <Feather name="refresh-cw" size={14} color={C.accentB} />
      </Animated.View>
      <Text style={styles.syncBtnTxt}>Sync now</Text>
    </Tappable>
  );
}

function CalRow({ c, on, main, delay, last, onPress }: { c: DeviceCalendar; on: boolean; main: boolean; delay: number; last: boolean; onPress: () => void }) {
  const v = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    v.value = withSpring(on ? 1 : 0, sp({ damping: 16, stiffness: 240 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);
  const tint = hexA(c.color, 0.1); // (worked out here — plain JS can't run inside the worklet)
  const bg = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(v.value, [0, 1], ['rgba(255,255,255,0)', tint]) }));
  const check = useAnimatedStyle(() => ({ opacity: v.value, transform: [{ scale: 0.4 + 0.6 * v.value }] }));
  const ring = useAnimatedStyle(() => ({ transform: [{ scale: 1 + 0.18 * v.value }] }));
  return (
    <Appear from="up" delay={delay} distance={8}>
      <Tappable onPress={onPress} scaleTo={0.97}>
        <Animated.View style={[styles.calRow, !last && styles.calRowLine, bg]}>
          <Animated.View style={[styles.calDot, { backgroundColor: c.color, boxShadow: `0 0 0 3px ${hexA(c.color, 0.22)}` }, ring]} />
          <View style={{ flex: 1 }}>
            <View style={styles.calNameRow}>
              <Text style={[styles.calName, !c.visible && { color: C.textDim }]} numberOfLines={1}>
                {c.name}
              </Text>
              {main && (
                <Appear from="pop" style={[styles.mainBadge, { backgroundColor: hexA(c.color, 0.18) }]}>
                  <Text style={[styles.mainBadgeTxt, { color: c.color }]}>MAIN</Text>
                </Appear>
              )}
            </View>
            {(!c.writable || !c.visible || c.primary) && (
              <View style={styles.calMeta}>
                {c.primary && <Text style={styles.calMetaTxt}>Main calendar</Text>}
                {!c.writable && (
                  <>
                    <Feather name="lock" size={10} color={C.muted} />
                    <Text style={styles.calMetaTxt}>Read-only</Text>
                  </>
                )}
                {!c.visible && <Text style={styles.calMetaTxt}>Hidden in your calendar app</Text>}
              </View>
            )}
          </View>
          <Animated.View style={[styles.calCheck, { backgroundColor: c.color }, check]}>
            <Feather name="check" size={13} color="#0b0b0d" />
          </Animated.View>
        </Animated.View>
      </Tappable>
    </Appear>
  );
}

function Legend({ icon, text, last }: { icon: Icon; text: string; last?: boolean }) {
  return (
    <View style={[styles.legend, !last && styles.calRowLine]}>
      <Feather name={icon} size={14} color={C.accentB} style={{ marginTop: 1 }} />
      <Text style={styles.legendTxt}>{text}</Text>
    </View>
  );
}

// ---- Direction -------------------------------------------------------------

function DirectionPicker({ value, readOnly, color, onChange }: { value: CalDirection; readOnly: boolean; color: string; onChange: (d: CalDirection) => void }) {
  const [w, setW] = useState(0);
  const idx = DIRS.findIndex((d) => d.id === value);
  const x = useSharedValue(idx);
  useEffect(() => {
    x.value = withSpring(idx, sp({ damping: 19, stiffness: 260, mass: 0.8 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);
  const segW = w > 0 ? (w - 8) / 3 : 0;
  const hl = useAnimatedStyle(() => ({ width: segW, transform: [{ translateX: x.value * segW }] }));
  const d = DIRS[idx];
  return (
    <>
      <View style={styles.seg} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        {w > 0 && <Animated.View style={[styles.segHl, hl]} />}
        {DIRS.map((k) => {
          const on = k.id === value;
          const locked = readOnly && k.id !== 'fromCalendar';
          return (
            <Tappable key={k.id} onPress={() => onChange(k.id)} style={[styles.segBtn, locked && { opacity: 0.4 }]} scaleTo={0.94}>
              <Feather name={locked ? 'lock' : k.icon} size={13} color={on ? '#0b0b0d' : C.muted} />
              <Text style={[styles.segTxt, { color: on ? '#0b0b0d' : C.textDim }]} numberOfLines={1}>
                {k.label}
              </Text>
            </Tappable>
          );
        })}
      </View>
      <View style={styles.pvCard}>
        <FlowMock dir={value} color={color} />
        <Appear key={value} from="right" distance={10} style={styles.pvText}>
          <Text style={styles.pvTitle}>{d.title}</Text>
          <Text style={styles.pvBlurb}>{d.blurb}</Text>
          <View style={styles.feats}>
            {d.feats.map((f, i) => (
              <Appear key={f} from="pop" delay={80 + i * 50}>
                <View style={styles.feat}>
                  <Feather name="check" size={10} color={C.accentB} />
                  <Text style={styles.featTxt}>{f}</Text>
                </View>
              </Appear>
            ))}
          </View>
        </Appear>
      </View>
    </>
  );
}

// The direction acted out: tasks on one side, the calendar on the other, and
// changes flowing between them the chosen way(s).
function FlowMock({ dir, color }: { dir: CalDirection; color: string }) {
  const p = useSharedValue(0);
  const k = useSharedValue(0);
  useEffect(() => {
    cancelAnimation(p);
    p.value = 0;
    if (motion.enabled) p.value = withRepeat(withTiming(1, { duration: ms(1500), easing: Easing.linear }), -1, false);
    k.value = 0;
    k.value = withSpring(1, sp({ damping: 12, stiffness: 200 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir]);
  const toCal = dir !== 'fromCalendar';
  const fromCal = dir !== 'toCalendar';
  const pop = useAnimatedStyle(() => ({ transform: [{ scale: 0.85 + 0.15 * k.value }] }));
  return (
    <View style={styles.flow}>
      <Animated.View style={[styles.flowNode, { backgroundColor: hexA(C.accentB, 0.14) }, toCal && pop]}>
        <Feather name="check-square" size={15} color={C.accentB} />
      </Animated.View>
      <View style={styles.flowTrack}>
        {toCal && <Lane p={p} y={fromCal ? -5 : 0} color={C.accentB} ltr />}
        {fromCal && <Lane p={p} y={toCal ? 5 : 0} color={color} ltr={false} />}
      </View>
      <Animated.View style={[styles.flowNode, { backgroundColor: hexA(color, 0.16) }, fromCal && pop]}>
        <Feather name="calendar" size={15} color={color} />
      </Animated.View>
    </View>
  );
}

const TRACK = 34;
function Lane({ p, y, color, ltr }: { p: SharedValue<number>; y: number; color: string; ltr: boolean }) {
  return (
    <View style={[styles.lane, { top: 13 + y }]}>
      <View style={[styles.laneLine, { backgroundColor: hexA(color, 0.22) }]} />
      {[0, 1 / 3, 2 / 3].map((o) => (
        <FlowDot key={o} p={p} offset={o} color={color} ltr={ltr} />
      ))}
    </View>
  );
}

function FlowDot({ p, offset, color, ltr }: { p: SharedValue<number>; offset: number; color: string; ltr: boolean }) {
  const s = useAnimatedStyle(() => {
    const f = (p.value + offset) % 1;
    return {
      opacity: interpolate(f, [0, 0.2, 0.8, 1], [0, 1, 1, 0]),
      transform: [{ translateX: (ltr ? f : 1 - f) * (TRACK - 4) }],
    };
  });
  return <Animated.View style={[styles.flowDot, { backgroundColor: color }, s]} />;
}

const styles = StyleSheet.create({
  master: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 14 },
  masterIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  masterTitle: { fontSize: 15.5, fontWeight: '700', color: C.text },
  masterSub: { fontSize: 12.5, color: C.muted, marginTop: 2 },
  note: { flexDirection: 'row', gap: 9, alignItems: 'flex-start', marginTop: 10, padding: 12, borderRadius: 14, backgroundColor: 'rgba(124,124,240,0.08)' },
  intro: { marginTop: 12, padding: 18, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.03)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)' },
  introArt: { alignSelf: 'center', marginBottom: 14, transform: [{ scale: 1.25 }] },
  introTitle: { fontSize: 17, fontWeight: '800', color: C.text, textAlign: 'center', marginBottom: 12 },
  introLine: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 7 },
  introIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(79,209,197,0.12)' },
  introTxt: { flex: 1, fontSize: 13.5, color: C.textDim, lineHeight: 18 },
  introBtn: { marginTop: 14, height: 48, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.accentB },
  introBtnTxt: { fontSize: 15, fontWeight: '800', color: '#0b0b0d' },
  noteTxt: { flex: 1, fontSize: 12.5, color: C.textDim, lineHeight: 17 },
  section: { fontSize: 11, color: C.muted, fontWeight: '700', marginBottom: 9, marginTop: 20, letterSpacing: 0.3 },
  card: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  loading: { paddingVertical: 14 },
  empty: { color: C.faint, fontSize: 13, textAlign: 'center' },
  emptyBox: { alignItems: 'center', paddingVertical: 16, paddingHorizontal: 8, gap: 6 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: C.text, marginTop: 4 },
  emptySub: { fontSize: 12.5, color: C.muted, textAlign: 'center', lineHeight: 17 },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, paddingHorizontal: 14, height: 38, borderRadius: 12, backgroundColor: 'rgba(79,209,197,0.12)' },
  linkBtnTxt: { fontSize: 13, fontWeight: '700', color: C.accentB },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', marginTop: 12, paddingHorizontal: 4, paddingVertical: 6 },
  banner: { flexDirection: 'row', gap: 12, padding: 14, borderRadius: 16, marginTop: 12 },
  bannerWarn: { backgroundColor: 'rgba(245,161,92,0.08)', boxShadow: 'inset 0 0 0 1px rgba(245,161,92,0.3)' },
  bannerTitle: { fontSize: 14.5, fontWeight: '800', color: C.text },
  bannerSub: { fontSize: 12.5, color: C.textDim, marginTop: 3, lineHeight: 17 },
  bannerBtns: { flexDirection: 'row', gap: 8 },
  bannerBtn: { marginTop: 10, alignSelf: 'flex-start', paddingHorizontal: 14, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  bannerBtnTxt: { fontSize: 13, fontWeight: '800', color: C.text },
  statRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  stat: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 4 },
  statVal: { fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] },
  statLabel: { flex: 1, fontSize: 12, color: C.muted, fontWeight: '600', lineHeight: 15 },
  statSep: { width: 1, alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.06)', marginHorizontal: 8 },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)' },
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  syncWhen: { fontSize: 13.5, fontWeight: '700', color: C.textDim },
  syncErr: { fontSize: 13, fontWeight: '700', color: '#f5a15c', lineHeight: 17 },
  syncLast: { fontSize: 12, color: C.muted, marginTop: 2 },
  syncBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 13, height: 36, borderRadius: 11, backgroundColor: 'rgba(79,209,197,0.12)' },
  syncBtnTxt: { fontSize: 13, fontWeight: '800', color: C.accentB },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 8, paddingBottom: 4, paddingHorizontal: 2 },
  groupTitle: { flexShrink: 1, fontSize: 12, fontWeight: '700', color: C.muted },
  groupNote: { fontSize: 11, color: C.faint, fontWeight: '600' },
  calRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 8, marginHorizontal: -6, borderRadius: 12 },
  calRowLine: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  calDot: { width: 12, height: 12, borderRadius: 6, marginLeft: 3 },
  calName: { flexShrink: 1, fontSize: 14.5, fontWeight: '700', color: C.text },
  calMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  calMetaTxt: { fontSize: 11.5, color: C.muted, fontWeight: '600' },
  calCheck: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  seg: { flexDirection: 'row', padding: 4, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)' },
  segHl: { position: 'absolute', top: 4, bottom: 4, left: 4, borderRadius: 10, backgroundColor: C.accentB },
  segBtn: { flex: 1, height: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  segTxt: { fontSize: 12.5, fontWeight: '800', flexShrink: 1 },
  pvCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 10,
    padding: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.03)',
    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.05)',
  },
  pvText: { flex: 1 },
  pvTitle: { fontSize: 14.5, fontWeight: '800', color: C.text },
  pvBlurb: { fontSize: 12.5, color: C.muted, marginTop: 3, lineHeight: 17 },
  feats: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 9 },
  feat: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 22, borderRadius: 7, backgroundColor: 'rgba(79,209,197,0.1)' },
  featTxt: { fontSize: 11, fontWeight: '700', color: C.accentB },
  flow: { flexDirection: 'row', alignItems: 'center', width: 104 },
  flowNode: { width: 35, height: 35, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  flowTrack: { width: TRACK, height: 30 },
  lane: { position: 'absolute', left: 0, right: 0, height: 4 },
  laneLine: { position: 'absolute', left: 2, right: 2, top: 1.5, height: 1, borderRadius: 1 },
  flowDot: { position: 'absolute', top: 0, left: 0, width: 4, height: 4, borderRadius: 2 },
  legend: { flexDirection: 'row', gap: 10, paddingVertical: 10, paddingHorizontal: 2 },
  legendTxt: { flex: 1, fontSize: 12.5, color: C.textDim, lineHeight: 17 },
  calNameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  mainBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  mainBadgeTxt: { fontSize: 9.5, fontWeight: '900', letterSpacing: 0.5 },
  mainRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  mainChip: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, height: 38, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', maxWidth: '100%' },
  mainDot: { width: 9, height: 9, borderRadius: 5 },
  mainTxt: { fontSize: 13.5, fontWeight: '700', color: C.textDim, flexShrink: 1 },
  popIcon: { alignSelf: 'center', width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  popTitle: { fontSize: 17, fontWeight: '800', color: C.text, textAlign: 'center', marginBottom: 12 },
  popLine: { flexDirection: 'row', gap: 9, alignItems: 'flex-start', padding: 11, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)' },
  popLineTxt: { flex: 1, fontSize: 13, color: C.textDim, lineHeight: 18 },
  popBtns: { flexDirection: 'row', gap: 10, marginTop: 18 },
  popCancel: { flex: 1, height: 48, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.07)', alignItems: 'center', justifyContent: 'center' },
  popCancelTxt: { fontSize: 15, fontWeight: '700', color: C.text },
  popOk: { flex: 1, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  popOkTxt: { fontSize: 15, fontWeight: '800', color: '#0b0b0d' },
});
