import React, { useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { C } from '../theme';
import { Clock, Place, Tag, Task } from '../types';
import { fmt, fmtDur, hexA, dateLabel, placeLabel, tagLabel } from '../utils';
import { PlaceIcon } from './PlaceIcon';
import { BottomSheet } from './Overlay';
import { Tappable } from './anim';

export function TaskInfoSheet({
  task,
  tags,
  places,
  clock,
  onEdit,
  onToggleDone,
  onToggleSubtask,
  onClose,
}: {
  task: Task | null;
  tags: Tag[];
  places: Place[];
  clock: Clock;
  onEdit: () => void;
  onToggleDone: () => void;
  onToggleSubtask: (subId: string) => void;
  onClose: () => void;
}) {
  const visible = !!task;
  const tRef = useRef<Task | null>(task);
  if (task) tRef.current = task;
  const t = task ?? tRef.current;

  const tagTxt = t ? tagLabel(tags, t.tagId) : '';
  const placeTxt = t ? placeLabel(places, t.placeId) : '';
  const typeLabel = t?.type === 'allday' ? 'All-day' : t?.type === 'todo' ? 'To-do' : 'Planned';
  const doneCount = t ? t.subtasks.filter((s) => s.done).length : 0;

  return (
    <BottomSheet open={visible} onClose={onClose}>
      {t && (
        <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
          <View style={styles.header}>
            <LinearGradient colors={[t.color, hexA(t.color, 0.75)]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={[styles.icon, { boxShadow: `0 6px 16px -4px ${hexA(t.color, 0.7)}` }]}>
              <Text style={styles.iconTxt}>{t.emoji}</Text>
            </LinearGradient>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, t.done && styles.strike]}>{t.title}</Text>
              <View style={styles.typeBadge}>
                <Text style={styles.typeTxt}>{typeLabel}</Text>
              </View>
            </View>
          </View>

          {t.type === 'planned' && <InfoRow icon="clock" text={`${fmt(t.start, clock)} – ${fmt(t.start + t.dur, clock)}  ·  ${fmtDur(t.dur)}`} />}
          {t.type !== 'todo' && <InfoRow icon="calendar" text={dateLabel(t.date)} />}

          {(!!tagTxt || !!placeTxt) && (
            <View style={styles.metaRow}>
              {!!tagTxt && (
                <View style={[styles.chip, { backgroundColor: hexA(t.color, 0.15), borderColor: hexA(t.color, 0.28) }]}>
                  <Text style={[styles.chipTxt, { color: t.color }]}>{tagTxt}</Text>
                </View>
              )}
              {!!placeTxt && (
                <View style={[styles.chip, styles.placeChip]}>
                  <PlaceIcon size={11} color={C.textDim} />
                  <Text style={styles.placeTxt}>{placeTxt}</Text>
                </View>
              )}
            </View>
          )}

          {t.subtasks.length > 0 && (
            <>
              <Text style={styles.section}>SUBTASKS · {doneCount}/{t.subtasks.length}</Text>
              {t.subtasks.map((s) => (
                <Tappable key={s.id} style={styles.subRow} onPress={() => onToggleSubtask(s.id)}>
                  <View style={[styles.subCheck, s.done && { backgroundColor: t.color }]}>{s.done && <Feather name="check" size={13} color="#0b0b0d" />}</View>
                  <Text style={[styles.subTxt, s.done && styles.subDone]}>{s.title || 'Untitled'}</Text>
                </Tappable>
              ))}
            </>
          )}

          {!!t.notes.trim() && (
            <>
              <Text style={styles.section}>NOTES</Text>
              <Text style={styles.notes}>{t.notes}</Text>
            </>
          )}

          <View style={styles.actions}>
            <Tappable onPress={onToggleDone} style={styles.completeBtn}>
              <Feather name={t.done ? 'rotate-ccw' : 'check'} size={16} color={C.text} />
              <Text style={styles.completeTxt}>{t.done ? 'Mark undone' : 'Complete'}</Text>
            </Tappable>
            <Tappable onPress={onEdit} style={styles.editWrap}>
              <LinearGradient colors={[C.accentA, C.accentB]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.edit}>
                <Feather name="edit-2" size={15} color="#0b0b0d" />
                <Text style={styles.editTxt}>Edit</Text>
              </LinearGradient>
            </Tappable>
          </View>
        </ScrollView>
      )}
    </BottomSheet>
  );
}

function InfoRow({ icon, text }: { icon: keyof typeof Feather.glyphMap; text: string }) {
  return (
    <View style={styles.infoRow}>
      <Feather name={icon} size={15} color={C.muted} />
      <Text style={styles.infoTxt}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 18 },
  icon: { width: 54, height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  iconTxt: { fontSize: 26 },
  title: { fontSize: 21, fontWeight: '700', color: C.text },
  strike: { textDecorationLine: 'line-through', color: '#8a8a92' },
  typeBadge: { alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 7, backgroundColor: 'rgba(255,255,255,0.06)' },
  typeTxt: { fontSize: 11, fontWeight: '700', color: C.muted, letterSpacing: 0.3 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  infoTxt: { fontSize: 15, color: C.textDim, fontWeight: '500', fontVariant: ['tabular-nums'] },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  chipTxt: { fontSize: 12, fontWeight: '600' },
  placeChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.12)' },
  placeTxt: { fontSize: 12, fontWeight: '600', color: C.textDim },
  section: { fontSize: 11, color: C.muted, fontWeight: '700', marginTop: 16, marginBottom: 10, letterSpacing: 0.3 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 9 },
  subCheck: { width: 22, height: 22, borderRadius: 7, boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  subTxt: { fontSize: 15, color: C.text, flex: 1 },
  subDone: { color: C.faint, textDecorationLine: 'line-through' },
  notes: { fontSize: 15, color: C.textDim, lineHeight: 21 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 22 },
  completeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.07)' },
  completeTxt: { fontSize: 15, fontWeight: '700', color: C.text },
  editWrap: { flex: 1, borderRadius: 16, overflow: 'hidden' },
  edit: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52 },
  editTxt: { fontSize: 15, fontWeight: '700', color: '#0b0b0d' },
});
