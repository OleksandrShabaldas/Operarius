import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, EMOJIS, C } from '../theme';
import { Clock, Draft, Place, Tag, TaskType } from '../types';
import { dateLabel, fmt, fmtDur, findTag, genId, hexA, todayKey } from '../utils';
import { PlaceIcon } from './PlaceIcon';
import { DatePickerPopup, DurationPickerPopup, SelectPopup, TimePickerPopup } from './pickers';
import { BottomSheet, CenterPopup } from './Overlay';
import { Tappable } from './anim';

type Props = {
  draft: Draft | null;
  tags: Tag[];
  places: Place[];
  clock: Clock;
  weekStart: 'mon' | 'sun';
  timePresets: number[];
  durationPresets: number[];
  onPatch: (patch: Partial<Draft>) => void;
  onSave: () => void;
  onDelete: () => void;
  onClose: () => void;
};

type Picker = 'icon' | 'start' | 'end' | 'dur' | 'date' | 'tag' | 'place' | null;

const TYPES: { id: TaskType; label: string }[] = [
  { id: 'planned', label: 'Planned' },
  { id: 'allday', label: 'All-day' },
  { id: 'todo', label: 'To-do' },
];

export function TaskEditorSheet({
  draft,
  tags,
  places,
  clock,
  weekStart,
  timePresets,
  durationPresets,
  onPatch,
  onSave,
  onDelete,
  onClose,
}: Props) {
  const visible = !!draft;
  const [picker, setPicker] = useState<Picker>(null);

  useEffect(() => {
    if (visible) setPicker(null);
  }, [visible, draft?.id]);

  // Keep the last draft during the close animation so content still renders.
  const dRef = useRef<Draft | null>(draft);
  if (draft) dRef.current = draft;
  const d = draft ?? dRef.current;
  const isEditing = !!d?.id;
  const end = d ? d.start + d.dur : 0;

  // Group sub-tags under their parent so both are selectable in the picker.
  const tagOptions: { id: string; label: string }[] = [];
  tags
    .filter((t) => !t.parentId)
    .forEach((top) => {
      tagOptions.push({ id: top.id, label: top.name });
      tags.filter((t) => t.parentId === top.id).forEach((sub) => tagOptions.push({ id: sub.id, label: '    ↳  ' + sub.name }));
    });
  const selTag = d ? findTag(tags, d.tagId) : null;

  const addSubtask = () => d && onPatch({ subtasks: [...d.subtasks, { id: genId(), title: '', done: false }] });
  const patchSubtask = (id: string, title: string) =>
    d && onPatch({ subtasks: d.subtasks.map((s) => (s.id === id ? { ...s, title } : s)) });
  const toggleSub = (id: string) =>
    d && onPatch({ subtasks: d.subtasks.map((s) => (s.id === id ? { ...s, done: !s.done } : s)) });
  const removeSub = (id: string) => d && onPatch({ subtasks: d.subtasks.filter((s) => s.id !== id) });

  return (
    <>
      <BottomSheet open={visible} onClose={onClose} height="80%" avoidKeyboard>
        {d && (
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} bounces={false}>
            <View style={styles.titleRow}>
              <Tappable onPress={() => setPicker('icon')}>
                <LinearGradient
                  colors={[d.color, hexA(d.color, 0.75)]}
                  start={{ x: 0.1, y: 0 }}
                  end={{ x: 0.9, y: 1 }}
                  style={[styles.marker, { boxShadow: `0 6px 16px -4px ${hexA(d.color, 0.7)}` }]}>
                  <Text style={styles.markerTxt}>{d.emoji}</Text>
                  <View style={styles.markerEdit}>
                    <Feather name="edit-2" size={9} color={C.textDim} />
                  </View>
                </LinearGradient>
              </Tappable>
              <TextInput
                value={d.title}
                onChangeText={(title) => onPatch({ title })}
                placeholder="Task name"
                placeholderTextColor={C.faint}
                style={styles.titleInput}
              />
            </View>

            <View style={styles.segment}>
              {TYPES.map((t) => {
                const on = d.type === t.id;
                return (
                  <Tappable key={t.id} onPress={() => onPatch({ type: t.id })} style={[styles.segBtn, on && styles.segBtnOn]}>
                    <Text style={[styles.segTxt, { color: on ? '#0b0b0d' : C.textDim }]}>{t.label}</Text>
                  </Tappable>
                );
              })}
            </View>

            {d.type === 'planned' && (
              <>
                <View style={styles.cardRow}>
                  <FieldCard label="START" value={fmt(d.start, clock)} onPress={() => setPicker('start')} />
                  <FieldCard label="END" value={fmt(end, clock)} onPress={() => setPicker('end')} />
                </View>
                <FieldCard label="DURATION" value={fmtDur(d.dur)} onPress={() => setPicker('dur')} full />
              </>
            )}

            {d.type !== 'todo' && <FieldCard label="DATE" value={dateLabel(d.date)} onPress={() => setPicker('date')} full />}

            <View style={styles.cardRow}>
              <Tappable style={styles.selCard} onPress={() => setPicker('tag')}>
                <Text style={styles.selLabel}>TAG</Text>
                <Text style={[styles.selVal, { color: selTag ? selTag.color : C.faint }]} numberOfLines={1}>
                  {selTag ? selTag.name : 'Select tag'}
                </Text>
              </Tappable>
              <Tappable style={styles.selCard} onPress={() => setPicker('place')}>
                <Text style={styles.selLabel}>PLACE</Text>
                <View style={styles.selPlaceRow}>
                  {!!d.placeId && <PlaceIcon size={12} color={C.textDim} />}
                  <Text style={[styles.selVal, { color: d.placeId ? C.text : C.faint }]} numberOfLines={1}>
                    {d.placeId ? places.find((p) => p.id === d.placeId)?.name || 'Select place' : 'Select place'}
                  </Text>
                </View>
              </Tappable>
            </View>

            <Text style={styles.section}>SUBTASKS</Text>
            {d.subtasks.map((s) => (
              <View key={s.id} style={styles.subRow}>
                <Tappable onPress={() => toggleSub(s.id)} style={[styles.subCheck, s.done && { backgroundColor: d.color }]}>
                  {s.done && <Feather name="check" size={13} color="#0b0b0d" />}
                </Tappable>
                <TextInput
                  value={s.title}
                  onChangeText={(t) => patchSubtask(s.id, t)}
                  placeholder="Subtask"
                  placeholderTextColor={C.faint}
                  style={[styles.subInput, s.done && styles.subDone]}
                />
                <Tappable onPress={() => removeSub(s.id)} hitSlop={8} style={styles.subX}>
                  <Feather name="x" size={15} color={C.faint} />
                </Tappable>
              </View>
            ))}
            <Tappable onPress={addSubtask} style={styles.addSub}>
              <Feather name="plus" size={15} color={C.accentA} />
              <Text style={styles.addSubTxt}>Add subtask</Text>
            </Tappable>

            <Text style={styles.section}>NOTES</Text>
            <TextInput
              value={d.notes}
              onChangeText={(notes) => onPatch({ notes })}
              placeholder="Add notes…"
              placeholderTextColor={C.faint}
              multiline
              style={styles.notes}
            />

            <View style={styles.actions}>
              {isEditing && (
                <Tappable onPress={onDelete} style={styles.delete}>
                  <Feather name="trash-2" size={18} color={C.danger} />
                </Tappable>
              )}
              <Tappable onPress={onSave} style={styles.saveWrap}>
                <LinearGradient colors={[C.accentA, C.accentB]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.save}>
                  <Text style={styles.saveTxt}>{isEditing ? 'Save changes' : 'Add task'}</Text>
                </LinearGradient>
              </Tappable>
            </View>
          </ScrollView>
        )}
      </BottomSheet>

      {/* Icon + color picker */}
      <CenterPopup open={picker === 'icon'} onClose={() => setPicker(null)}>
        {d && (
          <>
            <Text style={styles.pickerTitle}>Icon &amp; color</Text>
            <View style={styles.previewRow}>
              <LinearGradient colors={[d.color, hexA(d.color, 0.75)]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={styles.preview}>
                <Text style={styles.previewTxt}>{d.emoji}</Text>
              </LinearGradient>
            </View>
            <Text style={styles.section}>COLOR</Text>
            <View style={styles.wrapRow}>
              {COLORS.map((c) => (
                <Tappable
                  key={c}
                  onPress={() => onPatch({ color: c })}
                  style={[styles.swatch, { backgroundColor: c, boxShadow: d.color === c ? `0 0 0 3px ${C.sheet}, 0 0 0 5px ${c}` : undefined }]}
                />
              ))}
            </View>
            <Text style={styles.section}>ICON</Text>
            <View style={styles.wrapRow}>
              {EMOJIS.map((ch) => (
                <Tappable
                  key={ch}
                  onPress={() => onPatch({ emoji: ch })}
                  style={[styles.emoji, { backgroundColor: d.emoji === ch ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)', boxShadow: d.emoji === ch ? 'inset 0 0 0 1.5px rgba(255,255,255,0.4)' : undefined }]}>
                  <Text style={styles.emojiTxt}>{ch}</Text>
                </Tappable>
              ))}
            </View>
            <Tappable onPress={() => setPicker(null)} style={styles.pickerDone}>
              <Text style={styles.pickerDoneTxt}>Done</Text>
            </Tappable>
          </>
        )}
      </CenterPopup>

      <TimePickerPopup visible={picker === 'start'} title="Start" value={d?.start ?? 0} presets={timePresets} clock={clock} onChange={(v) => onPatch({ start: v })} onClose={() => setPicker(null)} />
      <TimePickerPopup visible={picker === 'end'} title="End" value={end} presets={timePresets} clock={clock} onChange={(v) => d && onPatch({ dur: Math.max(5, v - d.start) })} onClose={() => setPicker(null)} />
      <DurationPickerPopup visible={picker === 'dur'} value={d?.dur ?? 30} presets={durationPresets} onChange={(v) => onPatch({ dur: v })} onClose={() => setPicker(null)} />
      <DatePickerPopup visible={picker === 'date'} value={d?.date || todayKey()} weekStart={weekStart} onChange={(key) => onPatch({ date: key })} onClose={() => setPicker(null)} />
      <SelectPopup visible={picker === 'tag'} title="Select tag" options={tagOptions} selectedId={d?.tagId ?? null} emptyText="No tags yet — add some in Settings." onSelect={(id) => onPatch({ tagId: id })} onClose={() => setPicker(null)} />
      <SelectPopup visible={picker === 'place'} title="Select place" options={places.map((p) => ({ id: p.id, label: p.name }))} selectedId={d?.placeId ?? null} emptyText="No places yet — add some in Settings." onSelect={(id) => onPatch({ placeId: id })} onClose={() => setPicker(null)} />
    </>
  );
}

function FieldCard({ label, value, onPress, full }: { label: string; value: string; onPress: () => void; full?: boolean }) {
  return (
    <Tappable style={[styles.field, full && { marginBottom: 10 }]} onPress={onPress}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldVal}>{value}</Text>
    </Tappable>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  marker: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  markerTxt: { fontSize: 21 },
  markerEdit: { position: 'absolute', right: -3, bottom: -3, width: 18, height: 18, borderRadius: 9, backgroundColor: C.sheet, alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.15)' },
  titleInput: { flex: 1, color: C.text, fontSize: 21, fontWeight: '600', padding: 0 },
  segment: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  segBtn: { flex: 1, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
  segBtnOn: { backgroundColor: C.accentB },
  segTxt: { fontSize: 13.5, fontWeight: '700' },
  cardRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  field: { flex: 1, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 },
  fieldLabel: { fontSize: 11, color: C.muted, fontWeight: '600', marginBottom: 5 },
  fieldVal: { fontSize: 16, fontWeight: '700', color: C.text, fontVariant: ['tabular-nums'] },
  selCard: { flex: 1, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 },
  selLabel: { fontSize: 11, color: C.muted, fontWeight: '600', marginBottom: 5 },
  selVal: { fontSize: 15, fontWeight: '600' },
  selPlaceRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  section: { fontSize: 11, color: C.muted, fontWeight: '600', marginTop: 12, marginBottom: 9 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  subCheck: { width: 22, height: 22, borderRadius: 7, backgroundColor: 'transparent', boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  subInput: { flex: 1, color: C.text, fontSize: 15, paddingVertical: 6 },
  subDone: { color: C.faint, textDecorationLine: 'line-through' },
  subX: { padding: 4 },
  addSub: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, alignSelf: 'flex-start' },
  addSubTxt: { fontSize: 14, fontWeight: '600', color: C.accentA },
  notes: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, padding: 14, color: C.text, fontSize: 15, minHeight: 70, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  delete: { width: 52, height: 52, borderRadius: 16, backgroundColor: 'rgba(248,103,122,0.14)', alignItems: 'center', justifyContent: 'center' },
  saveWrap: { flex: 1, borderRadius: 16, overflow: 'hidden', boxShadow: `0 8px 24px -8px ${hexA('#7c7cf0', 0.7)}` },
  save: { height: 52, alignItems: 'center', justifyContent: 'center' },
  saveTxt: { fontSize: 16, fontWeight: '700', color: '#0b0b0d' },
  pickerTitle: { fontSize: 17, fontWeight: '700', color: C.text, marginBottom: 14 },
  previewRow: { alignItems: 'center', marginBottom: 12 },
  preview: { width: 60, height: 60, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  previewTxt: { fontSize: 28 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  swatch: { width: 32, height: 32, borderRadius: 16, marginVertical: 2, marginHorizontal: 1 },
  emoji: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  emojiTxt: { fontSize: 18 },
  pickerDone: { height: 48, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  pickerDoneTxt: { fontSize: 15, fontWeight: '700', color: C.text },
});
