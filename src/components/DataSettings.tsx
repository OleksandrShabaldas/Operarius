import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { cancelAnimation, Easing, FadeOut, interpolateColor, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { C } from '../theme';
import { motion, ms, sp } from '../motion';
import { Snapshot, useApp } from '../store';
import { dateKey, dateLabel, daysAgo, fmt, hexA } from '../utils';
import { Backup, BackupError, backupName, buildBackup, cleanupPhotos, countsOf, pickBackup, saveFile, share } from '../backup';
import { appEvents, removeAppEvents, syncedIds } from '../calendarSync';
import { CalSeen, Task } from '../types';
import { currentVersion } from '../updater';
import { CenterPopup } from './Overlay';
import { Appear, stagger, Tappable } from './anim';

type Icon = keyof typeof Feather.glyphMap;
// `undone`: what the note says once its undo is tapped.
type Note = { kind: 'ok' | 'err'; title: string; sub?: string; undo?: Snapshot; undone?: string; id: number };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const HOLD_MS = 1400; // "Delete all data" is pressed and held this long

// A snapshot to bring back after the app's own calendar events were removed:
// those tasks go back unlinked (sync writes them anew) and sync forgets it had
// seen those events. Everything else it remembers stays — an occurrence
// deleted here earlier stays deleted, rather than coming back as a new task.
function unlinkRemoved(s: Snapshot): Snapshot {
  const gone = new Set<string>();
  const tasks = s.tasks.map((t) => {
    if (!t.cal || t.cal.from || t.cal.master) return t;
    gone.add(t.cal.key);
    const { cal: _gone, ...rest } = t;
    return rest as Task;
  });
  const cal = s.settings.calendar;
  const keep = (seen: CalSeen[]) => seen.filter((e) => !gone.has(e.k));
  return { tasks, settings: { ...s.settings, calendar: { ...cal, seen: keep(cal.seen), extra: cal.extra.map((e) => ({ ...e, seen: keep(e.seen) })) } } };
}

function when(iso: string | number, clock: '12h' | '24h'): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'an unknown date';
  const day = dateLabel(dateKey(d));
  // "today" / "yesterday" read as words mid-sentence; dates keep their capitals
  return `${/^(Today|Tomorrow|Yesterday)$/.test(day) ? day.toLowerCase() : day} · ${fmt(d.getHours() * 60 + d.getMinutes(), clock)}`;
}

const clockOf = (at: number, clock: '12h' | '24h') => {
  const d = new Date(at);
  return fmt(d.getHours() * 60 + d.getMinutes(), clock);
};

// "3 days ago" (for the last backup)
function age(at: number, now = Date.now()): string {
  const days = daysAgo(at, now);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? 'a month ago' : `${months} months ago`;
}

// ---------------------------------------------------------------------------
// Settings → Data & backup.
// ---------------------------------------------------------------------------
export function DataSettings() {
  const { tasks, settings, updateSettings, importBackup, restoreSnapshot, resetAll, clearCompleted, clearAll } = useApp();
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState<'build' | 'save' | 'share' | 'read' | null>(null);
  const [incoming, setIncoming] = useState<Backup | null>(null);
  const [mode, setMode] = useState<'replace' | 'merge'>('replace');
  const [note, setNote] = useState<Note | null>(null);
  const [wiping, setWiping] = useState(false);
  const [alsoEvents, setAlsoEvents] = useState(false);
  // After "Delete all data" the old place photos stay on disk while it can be
  // undone, and go once it can't.
  const purge = useRef(false);
  const flushPurge = () => {
    if (!purge.current) return;
    purge.current = false;
    cleanupPhotos([]);
  };

  // A result note fades after a while (an undo stays up longer).
  useEffect(() => {
    if (!note) {
      flushPurge();
      return;
    }
    const t = setTimeout(() => setNote(null), note.undo ? 30000 : 7000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note]);
  useEffect(() => () => flushPurge(), []);

  const counts = countsOf(tasks, settings);
  const cal = settings.calendar;
  const ownEvents = cal.on && cal.direction !== 'fromCalendar' ? appEvents(tasks, syncedIds(cal)).length : 0;

  const wipe = async () => {
    const removed = alsoEvents && ownEvents ? await removeAppEvents(tasks, syncedIds(cal)) : 0;
    const before = resetAll();
    setWiping(false);
    purge.current = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    setNote({
      kind: 'ok',
      title: 'All data deleted',
      sub: removed ? `A fresh start — and ${plural(removed, 'event')} removed from “${cal.calendarName}”.` : 'Operarius is back to a fresh start.',
      undone: removed ? `Your data is back as it was, and its events are going back to “${cal.calendarName}”.` : undefined,
      undo: removed ? unlinkRemoved(before) : before,
      id: Date.now(),
    });
  };
  const last = settings.lastBackup;
  const stale = !last || Date.now() - last.at > 30 * 86400000;

  const confirm = (title: string, msg: string, action: () => void) =>
    Alert.alert(title, msg, [
      { text: 'Cancel', style: 'cancel' },
      { text: title, style: 'destructive', onPress: action },
    ]);

  const exportTo = async (how: 'save' | 'share') => {
    setBusy(how);
    try {
      const name = backupName();
      const { json, counts: c } = await buildBackup(tasks, settings, currentVersion());
      if (how === 'save') {
        const saved = await saveFile(json, name);
        if (!saved) return setBusy(null); // picker dismissed — the options stay open
        updateSettings({ lastBackup: { at: Date.now(), name: saved } });
        setNote({ kind: 'ok', title: 'Backup saved', sub: `${saved} · ${plural(c.tasks, 'task')}`, id: Date.now() });
      } else {
        await share(json, name);
        updateSettings({ lastBackup: { at: Date.now(), name } });
        setNote({ kind: 'ok', title: 'Backup ready', sub: `${name} · ${plural(c.tasks, 'task')}`, id: Date.now() });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setExporting(false);
    } catch (e) {
      setNote({ kind: 'err', title: 'Couldn’t export', sub: e instanceof BackupError ? e.message : 'Something went wrong writing the file — try another place.', id: Date.now() });
      setExporting(false);
    } finally {
      setBusy(null);
    }
  };

  const startImport = async () => {
    Haptics.selectionAsync().catch(() => {});
    setBusy('read');
    try {
      const b = await pickBackup();
      if (b) {
        setMode('replace');
        setIncoming(b);
      }
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setNote({ kind: 'err', title: 'Couldn’t read that file', sub: e instanceof BackupError ? e.message : 'The file couldn’t be opened.', id: Date.now() });
    } finally {
      setBusy(null);
    }
  };

  const restore = () => {
    if (!incoming) return;
    const before: Snapshot = { tasks, settings };
    const r = importBackup(incoming, mode);
    setIncoming(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    if (mode === 'replace')
      setNote({ kind: 'ok', title: 'Backup restored', sub: `${plural(r.tasks, 'task')}, ${plural(r.tags, 'tag')} and ${plural(r.places, 'place')}`, undo: before, id: Date.now() });
    else {
      const added = [r.tasks && plural(r.tasks, 'task'), r.tags && plural(r.tags, 'tag'), r.places && plural(r.places, 'place')].filter(Boolean);
      setNote({
        kind: 'ok',
        title: added.length ? `Added ${added.join(', ')}` : 'Nothing new to add',
        sub: added.length ? 'Everything you had is still here.' : 'Everything in that backup is already here.',
        undo: added.length ? before : undefined,
        id: Date.now(),
      });
    }
  };

  return (
    <View style={{ marginTop: 10 }}>
      {/* Result of the last action */}
      {note && (
        <Animated.View key={note.id} entering={stagger(0)} exiting={FadeOut.duration(ms(160))} style={[styles.note, note.kind === 'ok' ? styles.noteOk : styles.noteErr]}>
          <Appear from="pop" delay={60}>
            <Feather name={note.kind === 'ok' ? 'check-circle' : 'alert-triangle'} size={18} color={note.kind === 'ok' ? C.accentB : '#f5a15c'} />
          </Appear>
          <View style={{ flex: 1 }}>
            <Text style={styles.noteTitle}>{note.title}</Text>
            {!!note.sub && <Text style={styles.noteSub}>{note.sub}</Text>}
          </View>
          {note.undo ? (
            <Tappable
              onPress={() => {
                purge.current = false;
                restoreSnapshot(note.undo!);
                Haptics.selectionAsync().catch(() => {});
                setNote({ kind: 'ok', title: 'Undone', sub: note.undone ?? 'Your data is back as it was.', id: Date.now() });
              }}
              style={styles.undo}>
              <Feather name="rotate-ccw" size={13} color={C.accentB} />
              <Text style={styles.undoTxt}>Undo</Text>
            </Tappable>
          ) : (
            <Tappable onPress={() => setNote(null)} hitSlop={10} style={styles.noteX}>
              <Feather name="x" size={15} color={C.muted} />
            </Tappable>
          )}
        </Animated.View>
      )}

      {/* Backup */}
      <Text style={[styles.section, { marginTop: note ? 20 : 6 }]}>BACKUP</Text>
      <Appear from="up" delay={30} style={styles.card}>
        <View style={styles.lastRow}>
          <View style={[styles.lastIcon, { backgroundColor: hexA(stale ? '#f5a15c' : C.accentB, 0.14) }]}>
            <Feather name={last ? 'archive' : 'alert-circle'} size={18} color={stale ? '#f5a15c' : C.accentB} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.lastTitle}>{last ? `Last backup ${age(last.at)}` : 'No backup yet'}</Text>
            <Text style={styles.lastSub} numberOfLines={1}>
              {last ? `${daysAgo(last.at) <= 1 ? clockOf(last.at, settings.clock) : when(last.at, settings.clock)} · ${last.name}` : 'Export one to keep your tasks safe'}
            </Text>
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.inside}>
          <Count icon="check-square" n={counts.tasks} label="task" delay={70} />
          <Count icon="tag" n={counts.tags} label="tag" delay={100} />
          <Count icon="map-pin" n={counts.places} label="place" delay={130} />
          <Count icon="image" n={counts.photos} label="photo" delay={160} />
        </View>
      </Appear>

      <Appear from="up" delay={80}>
        <Tappable
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            setExporting(true);
          }}
          style={[styles.primaryWrap, styles.primaryShadow]}>
          <LinearGradient colors={[C.accentA, C.accentB]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.primary}>
            <Feather name="upload" size={17} color="#0b0b0d" />
            <Text style={styles.primaryTxt}>Export backup</Text>
          </LinearGradient>
        </Tappable>
      </Appear>
      <Appear from="up" delay={120}>
        <Tappable onPress={startImport} disabled={busy === 'read'} style={styles.secondary}>
          {busy === 'read' ? <ActivityIndicator size="small" color={C.accentA} /> : <Feather name="download" size={17} color={C.accentA} />}
          <Text style={styles.secondaryTxt}>Import backup</Text>
        </Tappable>
      </Appear>
      <Text style={styles.hint}>One file with every task, tag, place (photos included) and setting. Restore it here or on a new phone — Google Drive is a good home for it.</Text>

      {/* Clean-up */}
      <Text style={styles.section}>CLEAN UP</Text>
      <Appear from="up" delay={160}>
        <Tappable style={styles.rowBtn} onPress={() => confirm('Clear completed', 'Remove all completed tasks?', () => clearCompleted())}>
          <Feather name="check-circle" size={16} color={C.textDim} />
          <Text style={styles.rowBtnTxt}>Clear completed tasks</Text>
          <Feather name="chevron-right" size={20} color={C.muted} />
        </Tappable>
      </Appear>
      <Appear from="up" delay={190}>
        <Tappable style={styles.rowBtn} onPress={() => confirm('Delete all', 'Delete every task? Export a backup first if you might want them back.', clearAll)}>
          <Feather name="trash-2" size={16} color={C.danger} />
          <Text style={[styles.rowBtnTxt, { color: C.danger }]}>Delete all tasks</Text>
          <Feather name="chevron-right" size={20} color={C.danger} />
        </Tappable>
      </Appear>
      <Appear from="up" delay={220}>
        <Tappable
          style={[styles.rowBtn, styles.rowDanger]}
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            setAlsoEvents(false);
            setWiping(true);
          }}>
          <Feather name="alert-octagon" size={16} color={C.danger} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.rowBtnTxt, { color: C.danger }]}>Delete all data</Text>
            <Text style={styles.rowSub}>Tasks, tags, places, settings — a fresh start</Text>
          </View>
          <Feather name="chevron-right" size={20} color={C.danger} />
        </Tappable>
      </Appear>

      {/* Delete all data: what goes, and a press-and-hold to be sure */}
      <CenterPopup open={wiping} onClose={() => setWiping(false)}>
        <Appear from="pop" style={[styles.popIcon, { backgroundColor: hexA(C.danger, 0.16) }]}>
          <Feather name="alert-octagon" size={22} color={C.danger} />
        </Appear>
        <Text style={styles.popTitle}>Delete all data?</Text>
        <Text style={styles.popSub}>Every task, tag, place and setting goes. Operarius starts fresh, as on the day you installed it.</Text>
        <View style={[styles.inside, styles.insidePop]}>
          <Count icon="check-square" n={counts.tasks} label="task" delay={40} />
          <Count icon="tag" n={counts.tags} label="tag" delay={70} />
          <Count icon="map-pin" n={counts.places} label="place" delay={100} />
          <Count icon="image" n={counts.photos} label="photo" delay={130} />
        </View>
        {ownEvents > 0 && (
          <CheckRow
            on={alsoEvents}
            onToggle={() => setAlsoEvents((v) => !v)}
            title={`Also remove ${plural(ownEvents, 'event')} from “${cal.calendarName}”`}
            sub="The ones Operarius added. Events of the calendar itself stay."
            delay={150}
          />
        )}
        {(!settings.lastBackup || Date.now() - settings.lastBackup.at > 86400000) && counts.tasks > 0 && (
          <Appear from="up" delay={180} style={styles.popNote}>
            <Feather name="archive" size={13} color="#f5a15c" />
            <Text style={styles.popNoteTxt}>
              Want a copy first?{' '}
              <Text
                style={styles.inlineLink}
                onPress={() => {
                  setWiping(false);
                  setTimeout(() => setExporting(true), ms(340));
                }}>
                Export a backup
              </Text>
            </Text>
          </Appear>
        )}
        <HoldButton label="Hold to delete everything" onDone={wipe} />
        <Tappable style={styles.popCancel} onPress={() => setWiping(false)}>
          <Text style={styles.popCancelTxt}>Cancel</Text>
        </Tappable>
      </CenterPopup>

      {/* Export: where to */}
      <CenterPopup open={exporting} onClose={() => !busy && setExporting(false)}>
        <Appear from="pop" style={styles.popIcon}>
          <Feather name="upload" size={22} color={C.accentB} />
        </Appear>
        <Text style={styles.popTitle}>Export backup</Text>
        <Text style={styles.popSub}>
          {plural(counts.tasks, 'task')}, {plural(counts.tags, 'tag')} and {plural(counts.places, 'place')} in {backupName()}
        </Text>
        <Option icon="download" title="Save as a file" sub="Downloads, Google Drive or any folder" busy={busy === 'save'} disabled={!!busy} delay={60} onPress={() => exportTo('save')} />
        <Option icon="share-2" title="Share" sub="Google Drive, email, a chat…" busy={busy === 'share'} disabled={!!busy} delay={100} onPress={() => exportTo('share')} />
        <Tappable style={styles.popCancel} onPress={() => setExporting(false)} disabled={!!busy}>
          <Text style={styles.popCancelTxt}>Cancel</Text>
        </Tappable>
      </CenterPopup>

      {/* Import: what it holds, and how to restore */}
      <CenterPopup open={!!incoming} onClose={() => setIncoming(null)}>
        {incoming && (
          <>
            <Appear from="pop" style={[styles.popIcon, { backgroundColor: hexA(C.accentA, 0.16) }]}>
              <Feather name="download" size={22} color={C.accentA} />
            </Appear>
            <Text style={styles.popTitle}>Restore this backup?</Text>
            <Text style={styles.popSub}>
              Made {when(incoming.exportedAt, settings.clock)}
              {incoming.app ? ` · v${incoming.app}` : ''}
            </Text>
            <View style={[styles.inside, styles.insidePop]}>
              <Count icon="check-square" n={incoming.counts.tasks} label="task" delay={40} />
              <Count icon="tag" n={incoming.counts.tags} label="tag" delay={70} />
              <Count icon="map-pin" n={incoming.counts.places} label="place" delay={100} />
              <Count icon="image" n={incoming.counts.photos} label="photo" delay={130} />
            </View>
            <ModeCard
              on={mode === 'replace'}
              icon="refresh-ccw"
              title="Replace everything"
              sub={`Your ${plural(tasks.length, 'task')} and settings become the backup’s.`}
              danger
              delay={120}
              onPress={() => setMode('replace')}
            />
            <ModeCard
              on={mode === 'merge'}
              icon="plus-circle"
              title="Add what’s missing"
              sub="Keeps everything here; adds the tasks, tags and places that aren’t."
              delay={160}
              onPress={() => setMode('merge')}
            />
            {settings.calendar.on && (
              <Appear from="up" delay={200} style={styles.popNote}>
                <Feather name="calendar" size={13} color={C.muted} />
                <Text style={styles.popNoteTxt}>Google Calendar sync matches the restored tasks to their events — nothing is duplicated.</Text>
              </Appear>
            )}
            <View style={styles.popBtns}>
              <Tappable style={[styles.popCancel, { flex: 1, marginTop: 0 }]} onPress={() => setIncoming(null)}>
                <Text style={styles.popCancelTxt}>Cancel</Text>
              </Tappable>
              <Tappable style={[styles.popOk, { backgroundColor: mode === 'replace' ? C.danger : C.accentB }]} onPress={restore}>
                <Text style={styles.popOkTxt}>{mode === 'replace' ? 'Replace' : 'Add'}</Text>
              </Tappable>
            </View>
          </>
        )}
      </CenterPopup>
    </View>
  );
}

// Press and hold to confirm: the fill runs across; letting go early rolls it back.
function HoldButton({ label, onDone }: { label: string; onDone: () => void }) {
  const p = useSharedValue(0);
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = () => {
    setHolding(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    cancelAnimation(p);
    // Real time, whatever the animation speed — it's how sure you are.
    p.value = motion.enabled ? withTiming(1, { duration: HOLD_MS, easing: Easing.linear }) : 1;
    timer.current = setTimeout(() => {
      timer.current = null;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
      onDone();
    }, HOLD_MS);
  };
  const stop = () => {
    setHolding(false);
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    cancelAnimation(p);
    p.value = withTiming(0, { duration: ms(260), easing: Easing.out(Easing.cubic) });
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: p.value }] }));
  const press = useAnimatedStyle(() => ({ transform: [{ scale: 1 - 0.03 * Math.min(1, p.value * 4) }] }));
  return (
    <Appear from="up" delay={200}>
      <Pressable onPressIn={start} onPressOut={stop}>
        <Animated.View style={[styles.hold, press]}>
          <Animated.View style={[styles.holdFill, fill]} />
          <Feather name="trash-2" size={16} color="#fff" />
          <Text style={styles.holdTxt}>{holding ? 'Keep holding…' : label}</Text>
        </Animated.View>
      </Pressable>
    </Appear>
  );
}

function CheckRow({ on, onToggle, title, sub, delay }: { on: boolean; onToggle: () => void; title: string; sub: string; delay: number }) {
  const v = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    v.value = withSpring(on ? 1 : 0, sp({ damping: 15, stiffness: 280 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);
  const box = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(v.value, [0, 1], ['rgba(255,255,255,0)', C.danger]),
    borderColor: interpolateColor(v.value, [0, 1], ['rgba(255,255,255,0.25)', C.danger]),
  }));
  const tick = useAnimatedStyle(() => ({ opacity: v.value, transform: [{ scale: 0.5 + 0.5 * v.value }] }));
  return (
    <Appear from="up" delay={delay}>
      <Tappable
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          onToggle();
        }}
        scaleTo={0.98}
        style={styles.check}>
        <Animated.View style={[styles.checkBox, box]}>
          <Animated.View style={tick}>
            <Feather name="check" size={13} color="#0b0b0d" />
          </Animated.View>
        </Animated.View>
        <View style={{ flex: 1 }}>
          <Text style={styles.checkTitle}>{title}</Text>
          <Text style={styles.checkSub}>{sub}</Text>
        </View>
      </Tappable>
    </Appear>
  );
}

function Count({ icon, n, label, delay }: { icon: Icon; n: number; label: string; delay: number }) {
  return (
    <Appear from="up" delay={delay} distance={6} style={styles.count}>
      <Feather name={icon} size={13} color={C.muted} />
      <Text style={styles.countN}>{n}</Text>
      <Text style={styles.countL}>{n === 1 ? label : `${label}s`}</Text>
    </Appear>
  );
}

function Option({ icon, title, sub, busy, disabled, delay, onPress }: { icon: Icon; title: string; sub: string; busy: boolean; disabled: boolean; delay: number; onPress: () => void }) {
  return (
    <Appear from="up" delay={delay}>
      <Tappable onPress={onPress} disabled={disabled} style={[styles.option, disabled && !busy && { opacity: 0.5 }]}>
        <View style={styles.optIcon}>{busy ? <ActivityIndicator size="small" color={C.accentB} /> : <Feather name={icon} size={17} color={C.accentB} />}</View>
        <View style={{ flex: 1 }}>
          <Text style={styles.optTitle}>{title}</Text>
          <Text style={styles.optSub}>{sub}</Text>
        </View>
        <Feather name="chevron-right" size={18} color={C.muted} />
      </Tappable>
    </Appear>
  );
}

function ModeCard({ on, icon, title, sub, danger, delay, onPress }: { on: boolean; icon: Icon; title: string; sub: string; danger?: boolean; delay: number; onPress: () => void }) {
  const tint = danger ? C.danger : C.accentB;
  const v = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    v.value = withSpring(on ? 1 : 0, sp({ damping: 16, stiffness: 260 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);
  // (colours worked out here — plain JS can't run inside the animation worklet)
  const bgOn = hexA(tint, 0.1);
  const edgeOn = hexA(tint, 0.55);
  const card = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(v.value, [0, 1], ['rgba(255,255,255,0.03)', bgOn]),
    borderColor: interpolateColor(v.value, [0, 1], ['rgba(255,255,255,0.07)', edgeOn]),
  }));
  const dot = useAnimatedStyle(() => ({ transform: [{ scale: v.value }], opacity: v.value }));
  return (
    <Appear from="up" delay={delay}>
      <Tappable
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          onPress();
        }}
        scaleTo={0.97}>
        <Animated.View style={[styles.mode, card]}>
          <Feather name={icon} size={16} color={on ? tint : C.muted} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.modeTitle, on && { color: C.text }]}>{title}</Text>
            <Text style={styles.modeSub}>{sub}</Text>
          </View>
          <View style={[styles.radio, { borderColor: on ? tint : 'rgba(255,255,255,0.2)' }]}>
            <Animated.View style={[styles.radioDot, { backgroundColor: tint }, dot]} />
          </View>
        </Animated.View>
      </Tappable>
    </Appear>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 11, color: C.muted, fontWeight: '700', marginBottom: 9, marginTop: 20, letterSpacing: 0.3 },
  hint: { fontSize: 12, color: C.muted, lineHeight: 17, marginTop: 10 },
  card: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 4 },
  lastRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  lastIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  lastTitle: { fontSize: 15, fontWeight: '800', color: C.text },
  lastSub: { fontSize: 12, color: C.muted, marginTop: 2, fontVariant: ['tabular-nums'] },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)' },
  inside: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12 },
  insidePop: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12, paddingHorizontal: 12, marginBottom: 12 },
  count: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  countN: { fontSize: 15, fontWeight: '800', color: C.text, fontVariant: ['tabular-nums'] },
  countL: { fontSize: 11.5, color: C.muted, fontWeight: '600' },
  primaryWrap: { marginTop: 12, borderRadius: 14 },
  primaryShadow: { boxShadow: '0 10px 24px -10px rgba(124,124,240,0.7)' },
  primary: { height: 52, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  primaryTxt: { fontSize: 15.5, fontWeight: '800', color: '#0b0b0d' },
  secondary: {
    marginTop: 10,
    height: 50,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    backgroundColor: 'rgba(124,124,240,0.1)',
    boxShadow: 'inset 0 0 0 1px rgba(124,124,240,0.3)',
  },
  secondaryTxt: { fontSize: 15, fontWeight: '800', color: C.accentA },
  rowBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 16, marginBottom: 8 },
  rowBtnTxt: { flex: 1, fontSize: 15, fontWeight: '600', color: C.text },
  rowDanger: { backgroundColor: 'rgba(248,103,122,0.07)', boxShadow: 'inset 0 0 0 1px rgba(248,103,122,0.22)' },
  rowSub: { fontSize: 12, color: C.muted, marginTop: 2 },
  hold: { marginTop: 14, height: 52, borderRadius: 14, overflow: 'hidden', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(248,103,122,0.28)' },
  holdFill: { position: 'absolute', left: 0, top: 0, bottom: 0, right: 0, backgroundColor: C.danger, transformOrigin: 'left' },
  holdTxt: { fontSize: 15, fontWeight: '800', color: '#fff' },
  check: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.04)', marginBottom: 8 },
  checkBox: { width: 22, height: 22, borderRadius: 7, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  checkTitle: { fontSize: 14, fontWeight: '700', color: C.text },
  checkSub: { fontSize: 12, color: C.muted, marginTop: 2, lineHeight: 16 },
  inlineLink: { color: C.accentB, fontWeight: '800' },
  note: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16 },
  noteOk: { backgroundColor: 'rgba(79,209,197,0.08)', boxShadow: 'inset 0 0 0 1px rgba(79,209,197,0.28)' },
  noteErr: { backgroundColor: 'rgba(245,161,92,0.08)', boxShadow: 'inset 0 0 0 1px rgba(245,161,92,0.3)' },
  noteTitle: { fontSize: 14.5, fontWeight: '800', color: C.text },
  noteSub: { fontSize: 12.5, color: C.textDim, marginTop: 2, lineHeight: 17 },
  noteX: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  undo: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, height: 34, borderRadius: 10, backgroundColor: 'rgba(79,209,197,0.14)' },
  undoTxt: { fontSize: 13, fontWeight: '800', color: C.accentB },
  popIcon: { alignSelf: 'center', width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 12, backgroundColor: 'rgba(79,209,197,0.14)' },
  popTitle: { fontSize: 17, fontWeight: '800', color: C.text, textAlign: 'center' },
  popSub: { fontSize: 12.5, color: C.muted, textAlign: 'center', marginTop: 4, marginBottom: 14, lineHeight: 17 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', marginBottom: 8 },
  optIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(79,209,197,0.12)' },
  optTitle: { fontSize: 15, fontWeight: '700', color: C.text },
  optSub: { fontSize: 12, color: C.muted, marginTop: 2 },
  mode: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, borderWidth: 1, marginBottom: 8 },
  modeTitle: { fontSize: 14.5, fontWeight: '800', color: C.textDim },
  modeSub: { fontSize: 12, color: C.muted, marginTop: 2, lineHeight: 16 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  popNote: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingHorizontal: 4, marginTop: 2 },
  popNoteTxt: { flex: 1, fontSize: 12, color: C.muted, lineHeight: 16 },
  popBtns: { flexDirection: 'row', gap: 10, marginTop: 14 },
  popCancel: { height: 48, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.07)', alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  popCancelTxt: { fontSize: 15, fontWeight: '700', color: C.text },
  popOk: { flex: 1, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  popOkTxt: { fontSize: 15, fontWeight: '800', color: '#0b0b0d' },
});
