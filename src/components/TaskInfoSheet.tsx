import React, { useRef, useState } from 'react';
import { Image, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { fmtCoords, hasLocation, mapsUrlFor } from '../maps';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { C } from '../theme';
import { Clock, Place, Tag, Task } from '../types';
import { fmt, fmtDur, hexA, dateKey, dateLabel, findTag, placeLabel, repeatSummary, tagLabel } from '../utils';
import { useApp } from '../store';
import { reminderLines, whenLabel } from '../reminders';
import { INTENSITY } from './ReminderBits';
import { PlaceIcon } from './PlaceIcon';
import { BottomSheet, CenterPopup } from './Overlay';
import { Appear, Tappable } from './anim';

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
  const [placeOpen, setPlaceOpen] = useState(false);

  const tag = t ? findTag(tags, t.tagId) : null;
  const tagColor = tag?.color || t?.color || C.accentA;
  const place = t && t.placeId ? places.find((p) => p.id === t.placeId) || null : null;
  const placeTxt = t ? placeLabel(places, t.placeId) : '';
  const typeLabel = t?.type === 'allday' ? 'All-day' : t?.type === 'todo' ? 'To-do' : 'Planned';
  const doneCount = t ? t.subtasks.filter((s) => s.done).length : 0;

  const placeTag = place?.tagId ? findTag(tags, place.tagId) : null;

  // Reminders for this occurrence, with when each fires.
  const { settings } = useApp();
  const remLines = t ? reminderLines(t, t.date, settings) : [];
  const rem = t?.reminders ? INTENSITY[t.reminders.intensity] : null;
  const remTime = (at: number | null, kind: string) => {
    if (at == null) return '';
    const d = new Date(at);
    const hm = fmt(d.getHours() * 60 + d.getMinutes(), clock);
    // Before / after on another day than the task (e.g. the evening before) says which.
    return kind !== 'custom' && t && dateKey(d) !== t.date ? whenLabel(at, clock) : hm;
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
                  <Text style={[styles.chipTxt, { color: tagColor }]}>{tagLabel(tag)}</Text>
                </View>
              )}
              {!!place && (
                <Tappable onPress={() => setPlaceOpen(true)} style={[styles.chip, styles.placeChip]}>
                  <PlaceIcon size={11} color={C.textDim} />
                  <Text style={styles.placeTxt}>{place.name}</Text>
                  {place.photoUri && <Feather name="image" size={11} color={C.muted} />}
                  <Feather name="chevron-right" size={12} color={C.accentB} />
                </Tappable>
              )}
            </View>
          )}

          {remLines.length > 0 && rem && (
            <>
              <View style={styles.remHead}>
                <Text style={[styles.section, styles.remHeadTxt]}>REMINDERS</Text>
                {settings.remindersOn ? (
                  <View style={[styles.remChip, { backgroundColor: hexA(rem.color, 0.14) }]}>
                    <Feather name={rem.icon} size={10} color={rem.color} />
                    <Text style={[styles.remChipTxt, { color: rem.color }]}>{rem.label}</Text>
                  </View>
                ) : (
                  <View style={[styles.remChip, { backgroundColor: 'rgba(255,255,255,0.06)' }]}>
                    <Feather name="pause" size={10} color={C.muted} />
                    <Text style={[styles.remChipTxt, { color: C.muted }]}>Paused in Settings</Text>
                  </View>
                )}
              </View>
              {remLines.map((l, i) => {
                // Passed, or the task is already done: it won't ring.
                const off = l.past || t.done;
                return (
                  <Appear key={l.key} from="up" delay={40 + i * 35} distance={6}>
                    <View style={styles.remRow}>
                      <View style={[styles.remIcon, { backgroundColor: hexA(off ? C.faint : rem.color, 0.13) }]}>
                        <Feather name={l.kind === 'custom' ? 'calendar' : l.kind === 'before' ? 'skip-back' : 'skip-forward'} size={12} color={off ? C.faint : rem.color} />
                      </View>
                      <Text style={[styles.remLabel, off && styles.remPast]} numberOfLines={1}>
                        {l.label}
                      </Text>
                      <Text style={[styles.remTime, off && styles.remPast]}>{remTime(l.at, l.kind)}</Text>
                    </View>
                  </Appear>
                );
              })}
            </>
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

          {/* Place card: its photo, where it is, and the way to get there. */}
          <CenterPopup open={placeOpen} onClose={() => setPlaceOpen(false)} cardStyle={styles.placeCard}>
            {place && (
              <>
                <View style={styles.hero}>
                  {place.photoUri ? (
                    <Image source={{ uri: place.photoUri }} style={styles.heroImg} resizeMode="cover" />
                  ) : (
                    <LinearGradient colors={[hexA(placeTag?.color ?? C.accentB, 0.32), 'rgba(22,23,25,0)']} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={[styles.heroImg, styles.heroEmpty]}>
                      <Appear from="pop" delay={80}>
                        <View style={styles.heroPin}>
                          <PlaceIcon size={26} color={placeTag?.color ?? C.accentB} />
                        </View>
                      </Appear>
                    </LinearGradient>
                  )}
                  <LinearGradient colors={['rgba(11,11,13,0)', 'rgba(11,11,13,0.82)']} style={styles.heroShade} />
                  <Appear from="up" delay={60} style={styles.heroText}>
                    <Text style={styles.heroName} numberOfLines={2}>
                      {place.name}
                    </Text>
                    {placeTag && (
                      <View style={[styles.heroTag, { backgroundColor: hexA(placeTag.color, 0.22) }]}>
                        <Text style={[styles.heroTagTxt, { color: placeTag.color }]}>{placeTag.name}</Text>
                      </View>
                    )}
                  </Appear>
                </View>

                <View style={styles.placeBody}>
                  <Appear from="up" delay={110} style={styles.locRow}>
                    <Feather name="map-pin" size={15} color={hasLocation(place) ? C.accentB : C.faint} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.locTxt} numberOfLines={2}>
                        {hasLocation(place) ? place.address || 'Pinned on Google Maps' : 'No location picked yet'}
                      </Text>
                      {place.lat != null && place.lng != null && <Text style={styles.locSub}>{fmtCoords(place.lat, place.lng)}</Text>}
                    </View>
                  </Appear>

                  <Appear from="up" delay={160}>
                    <Tappable onPress={() => Linking.openURL(mapsUrlFor(place)).catch(() => {})} style={styles.mapsWrap}>
                      <LinearGradient colors={['#4fd1c5', '#5b9df9']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.mapsBtn}>
                        <Feather name="navigation" size={15} color="#0b0b0d" />
                        <Text style={styles.mapsTxt}>{hasLocation(place) ? 'Show on Google Maps' : 'Search on Google Maps'}</Text>
                      </LinearGradient>
                    </Tappable>
                  </Appear>
                  <Tappable onPress={() => setPlaceOpen(false)} style={styles.closeBtn}>
                    <Text style={styles.closeTxt}>Close</Text>
                  </Tappable>
                </View>
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
  placeCard: { padding: 0, overflow: 'hidden' },
  hero: { height: 200, backgroundColor: 'rgba(255,255,255,0.03)' },
  heroImg: { ...StyleSheet.absoluteFill },
  heroEmpty: { alignItems: 'center', justifyContent: 'center', paddingBottom: 30 },
  heroPin: { width: 62, height: 62, borderRadius: 20, backgroundColor: 'rgba(11,11,13,0.45)', alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1)' },
  heroShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 110 },
  heroText: { position: 'absolute', left: 18, right: 18, bottom: 14, gap: 7 },
  heroName: { fontSize: 22, fontWeight: '800', color: '#fff' },
  heroTag: { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 7 },
  heroTagTxt: { fontSize: 11.5, fontWeight: '800' },
  placeBody: { padding: 18, paddingTop: 16, gap: 12 },
  locRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  locTxt: { fontSize: 14.5, fontWeight: '600', color: C.textDim },
  locSub: { fontSize: 12, fontWeight: '600', color: C.muted, marginTop: 2, fontVariant: ['tabular-nums'] },
  mapsWrap: { borderRadius: 14, overflow: 'hidden', boxShadow: '0 8px 22px -10px rgba(79,209,197,0.7)' },
  mapsBtn: { height: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  mapsTxt: { fontSize: 15, fontWeight: '800', color: '#0b0b0d' },
  closeBtn: { height: 46, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.07)', alignItems: 'center', justifyContent: 'center' },
  closeTxt: { fontSize: 15, fontWeight: '700', color: C.text },
  section: { fontSize: 11, color: C.muted, fontWeight: '700', marginTop: 16, marginBottom: 10, letterSpacing: 0.3 },
  remHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, marginBottom: 10 },
  remHeadTxt: { marginTop: 0, marginBottom: 0 },
  remChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7 },
  remChipTxt: { fontSize: 11, fontWeight: '800' },
  remRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 9 },
  remIcon: { width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  remLabel: { flex: 1, fontSize: 14.5, color: C.text, fontWeight: '500' },
  remTime: { fontSize: 14, color: C.textDim, fontWeight: '700', fontVariant: ['tabular-nums'], paddingRight: 1 },
  remPast: { color: C.faint, textDecorationLine: 'line-through' },
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
