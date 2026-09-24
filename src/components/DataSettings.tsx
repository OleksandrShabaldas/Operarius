import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeOut, interpolateColor, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { C } from '../theme';
import { ms, sp } from '../motion';
import { Snapshot, useApp } from '../store';
import { dateKey, dateLabel, fmt, hexA } from '../utils';
import { Backup, BackupError, backupName, buildBackup, countsOf, pickBackup, saveFile, share } from '../backup';
import { currentVersion } from '../updater';
import { CenterPopup } from './Overlay';
import { Appear, stagger, Tappable } from './anim';

type Icon = keyof typeof Feather.glyphMap;
type Note = { kind: 'ok' | 'err'; title: string; sub?: string; undo?: Snapshot; id: number };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

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
  const days = Math.floor((now - at) / 86400000);
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
  const { tasks, settings, updateSettings, importBackup, restoreSnapshot, clearCompleted, clearAll } = useApp();
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState<'build' | 'save' | 'share' | 'read' | null>(null);
  const [incoming, setIncoming] = useState<Backup | null>(null);
  const [mode, setMode] = useState<'replace' | 'merge'>('replace');
  const [note, setNote] = useState<Note | null>(null);

  // A result note fades after a while (an undo stays up longer).
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), note.undo ? 30000 : 7000);
    return () => clearTimeout(t);
  }, [note]);

  const counts = countsOf(tasks, settings);
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
                restoreSnapshot(note.undo!);
                Haptics.selectionAsync().catch(() => {});
                setNote({ kind: 'ok', title: 'Undone', sub: 'Your data is back as it was.', id: Date.now() });
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
              {last ? `${Date.now() - last.at < 2 * 86400000 ? clockOf(last.at, settings.clock) : when(last.at, settings.clock)} · ${last.name}` : 'Export one to keep your tasks safe'}
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
