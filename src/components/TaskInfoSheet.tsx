import React, { useRef, useState } from 'react';
import { Image, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { C } from '../theme';
import { Clock, Place, Tag, Task } from '../types';
import { fmt, fmtDur, hexA, dateLabel, findTag, placeLabel, repeatSummary } from '../utils';
import { PlaceIcon } from './PlaceIcon';
import { BottomSheet, CenterPopup } from './Overlay';
import { Tappable } from './anim';

export function TaskInfoSheet({
  task,
  tags,
  places,
  clock,
  onEdit,
  onCopy,
  onToggleDone,
  onToggleSubtask,
  onClose,
}: {
  task: Task | null;
  tags: Tag[];
  places: Place[];
  clock: Clock;
  onEdit: () => void;
  onCopy: () => void;
  onToggleDone: () => void;
  onToggleSubtask: (subId: string) => void;
  onClose: () => void;
}) {
  const visible = !!task;
  const tRef = useRef<Task | null>(task);
  if (task) tRef.current = task;
  const t = task ?? tRef.current;
  const [photoPreview, setPhotoPreview] = useState(false);

  const tag = t ? findTag(tags, t.tagId) : null;
  const tagColor = tag?.color || t?.color || C.accentA;
  const place = t && t.placeId ? places.find((p) => p.id === t.placeId) || null : null;
  const placeTxt = t ? placeLabel(places, t.placeId) : '';
  const typeLabel = t?.type === 'allday' ? 'All-day' : t?.type === 'todo' ? 'To-do' : 'Planned';
  const doneCount = t ? t.subtasks.filter((s) => s.done).length : 0;

  const openPlace = () => {
    if (!place) return;
    const q = encodeURIComponent(place.link || place.name);
    const url = place.link.startsWith('http') ? place.link : `https://www.google.com/maps/search/?api=1&query=${q}`;
    Linking.openURL(url).catch(() => {});
  };

  return (
    <BottomSheet open={visible} onClose={onClose}>
      {t && (
        <ScrollView showsVerticalScrollIndicator={false} bounces={false} keyboardShouldPersistTaps="handled">
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
            <Tappable
              onPress={onToggleDone}
              scaleTo={0.86}
              style={[styles.doneBox, { boxShadow: `inset 0 0 0 2px ${t.done ? t.color : hexA(t.color, 0.5)}`, backgroundColor: t.done ? t.color : 'transparent' }]}>
              {t.done && <Feather name="check" size={18} color="#0b0b0d" />}
            </Tappable>
          </View>

          {t.type === 'planned' && <InfoRow icon="clock" text={`${fmt(t.start, clock)} – ${fmt(t.start + t.dur, clock)}  ·  ${fmtDur(t.dur)}`} />}
          {t.type !== 'todo' && <InfoRow icon="calendar" text={dateLabel(t.date)} />}
          {!!t.repeat && <InfoRow icon="repeat" text={repeatSummary(t.repeat)} />}

          {(!!tag || !!placeTxt) && (
            <View style={styles.metaRow}>
              {!!tag && (
                <View style={[styles.chip, { backgroundColor: hexA(tagColor, 0.15), borderColor: hexA(tagColor, 0.28) }]}>
                  <Text style={[styles.chipTxt, { color: tagColor }]}>{tag.name}</Text>
                </View>
              )}
              {!!place && (
                <Tappable
                  onPress={openPlace}
                  onLongPress={() => place.photoUri && setPhotoPreview(true)}
                  style={[styles.chip, styles.placeChip]}>
                  <PlaceIcon size={11} color={C.textDim} />
                  <Text style={styles.placeTxt}>{place.name}</Text>
                  {place.photoUri && <Feather name="image" size={11} color={C.muted} />}
                  <Feather name={place.link ? 'external-link' : 'map-pin'} size={11} color={C.accentB} />
                </Tappable>
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
            <Tappable onPress={onCopy} style={styles.completeBtn}>
              <Feather name="copy" size={16} color={C.text} />
              <Text style={styles.completeTxt}>Copy</Text>
            </Tappable>
            <Tappable onPress={onEdit} style={styles.editWrap}>
              <LinearGradient colors={[C.accentA, C.accentB]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.edit}>
                <Feather name="edit-2" size={15} color="#0b0b0d" />
                <Text style={styles.editTxt}>Edit</Text>
              </LinearGradient>
            </Tappable>
          </View>

          <CenterPopup open={photoPreview} onClose={() => setPhotoPreview(false)}>
            {place?.photoUri && (
              <>
                <Text style={styles.previewTitle}>{place.name}</Text>
                <Image source={{ uri: place.photoUri }} style={styles.previewImg} resizeMode="cover" />
              </>
            )}
          </CenterPopup>
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
  doneBox: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
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
  previewTitle: { fontSize: 16, fontWeight: '700', color: C.text, marginBottom: 12 },
  previewImg: { width: '100%', height: 240, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)' },
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
