import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, EMOJIS, C } from '../theme';
import { Clock, Draft, Place, Preset, Tag, TaskType } from '../types';
import { dateLabel, fmt, fmtDur, findTag, genId, hexA, repeatSummary, todayKey } from '../utils';
import { PlaceIcon } from './PlaceIcon';
import { DatePickerPopup, DurationPickerPopup, SelectPopup, TimePickerPopup } from './pickers';
import { RepeatPopup } from './RepeatPopup';
import { PlaceSelectPopup } from './PlaceSelectPopup';
import { BottomSheet, CenterPopup } from './Overlay';
import { Tappable } from './anim';

type Props = {
  draft: Draft | null;
  tags: Tag[];
  places: Place[];
  clock: Clock;
  weekStart: 'mon' | 'sun';
  timePresets: Preset[];
  durationPresets: Preset[];
  autoPickDate?: boolean; // open straight into the date picker (used when copying)
  onPatch: (patch: Partial<Draft>) => void;
  onSave: () => void;
  onDelete: () => void;
  onClose: () => void;
};

type Picker = 'icon' | 'start' | 'end' | 'dur' | 'date' | 'tag' | 'place' | 'repeat' | null;

const TYPES: { id: TaskType; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { id: 'planned', label: 'Planned', icon: 'clock' },
  { id: 'allday', label: 'All-day', icon: 'sun' },
  { id: 'todo', label: 'To-do', icon: 'check-circle' },
];

export function TaskEditorSheet({
  draft,
  tags,
  places,
  clock,
  weekStart,
  timePresets,
  durationPresets,
  autoPickDate,
  onPatch,
  onSave,
  onDelete,
  onClose,
}: Props) {
  const visible = !!draft;
  const [picker, setPicker] = useState<Picker>(null);
  const [attempted, setAttempted] = useState(false);
  const nameRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) {
      setAttempted(false);
      setPicker(autoPickDate ? 'date' : null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, draft?.id]);

  // Keep the last draft during the close animation so content still renders.
  const dRef = useRef<Draft | null>(draft);
  if (draft) dRef.current = draft;
  const d = draft ?? dRef.current;
  const isEditing = !!d?.id;
  const end = d ? d.start + d.dur : 0;
  const canSave = !!d?.title.trim();

  // Group sub-tags under their parent so both are selectable in the picker.
  const tagOptions: { id: string; label: string }[] = [];
  tags
    .filter((t) => !t.parentId)
    .forEach((top) => {
      tagOptions.push({ id: top.id, label: top.name });
      tags.filter((t) => t.parentId === top.id).forEach((sub) => tagOptions.push({ id: sub.id, label: '    ↳  ' + sub.name }));
    });
  const selTag = d ? findTag(tags, d.tagId) : null;
  const topTagId = selTag ? selTag.parentId ?? selTag.id : null;
  const topTagName = topTagId ? tags.find((t) => t.id === topTagId)?.name ?? null : null;
  const gTime = timePresets.filter((p) => p.tagId == null).map((p) => p.value);
  const tTime = topTagId ? timePresets.filter((p) => p.tagId === topTagId).map((p) => p.value) : [];
  const gDur = durationPresets.filter((p) => p.tagId == null).map((p) => p.value);
  const tDur = topTagId ? durationPresets.filter((p) => p.tagId === topTagId).map((p) => p.value) : [];

  const addSubtask = () => d && onPatch({ subtasks: [...d.subtasks, { id: genId(), title: '', done: false }] });
  const patchSubtask = (id: string, title: string) =>
    d && onPatch({ subtasks: d.subtasks.map((s) => (s.id === id ? { ...s, title } : s)) });
  const toggleSub = (id: string) =>
    d && onPatch({ subtasks: d.subtasks.map((s) => (s.id === id ? { ...s, done: !s.done } : s)) });
  const removeSub = (id: string) => d && onPatch({ subtasks: d.subtasks.filter((s) => s.id !== id) });

  const attemptSave = () => {
    if (!canSave) {
      setAttempted(true);
      nameRef.current?.focus();
      return;
    }
    onSave();
  };

  const placeName = d?.placeId ? places.find((p) => p.id === d.placeId)?.name : null;

  return (
    <>
      <BottomSheet open={visible} onClose={onClose} height="88%" avoidKeyboard>
        {d && (
          <>
            <View style={styles.header}>
              <Text style={styles.headerTitle}>{isEditing ? 'Edit task' : 'New task'}</Text>
              <Tappable onPress={onClose} hitSlop={8} style={styles.closeBtn}>
                <Feather name="x" size={20} color={C.textDim} />
              </Tappable>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={{ paddingBottom: 8 }}>
              {/* Name + icon/color marker */}
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
                <View style={{ flex: 1 }}>
                  <TextInput
                    ref={nameRef}
                    value={d.title}
                    onChangeText={(title) => {
                      onPatch({ title });
                      if (attempted && title.trim()) setAttempted(false);
                    }}
                    placeholder="Task name"
                    placeholderTextColor={C.faint}
                    style={[styles.titleInput, attempted && !canSave && styles.titleInputErr]}
                  />
                  {attempted && !canSave && <Text style={styles.errHint}>Give your task a name to continue</Text>}
                </View>
              </View>

              {/* Type */}
              <View style={styles.segment}>
                {TYPES.map((t) => {
                  const on = d.type === t.id;
                  return (
                    <Tappable key={t.id} onPress={() => onPatch({ type: t.id })} style={[styles.segBtn, on && styles.segBtnOn]}>
                      <Feather name={t.icon} size={14} color={on ? '#0b0b0d' : C.muted} />
                      <Text style={[styles.segTxt, { color: on ? '#0b0b0d' : C.textDim }]}>{t.label}</Text>
                    </Tappable>
                  );
                })}
              </View>

              {/* Schedule */}
              {d.type !== 'todo' && (
                <>
                  <SectionHeader icon="clock" label="SCHEDULE" />
                  {d.type === 'planned' && (
                    <>
                      <View style={styles.timeRow}>
                        <Tappable style={styles.timeCard} onPress={() => setPicker('start')}>
                          <Text style={styles.timeLabel}>START</Text>
                          <Text style={styles.timeVal}>{fmt(d.start, clock)}</Text>
                        </Tappable>
                        <Feather name="arrow-right" size={18} color={C.faint} />
                        <Tappable style={styles.timeCard} onPress={() => setPicker('end')}>
                          <Text style={styles.timeLabel}>END</Text>
                          <Text style={styles.timeVal}>{fmt(end, clock)}</Text>
                        </Tappable>
                      </View>
                      <FieldRow icon="watch" label="Duration" value={fmtDur(d.dur)} onPress={() => setPicker('dur')} />
                    </>
                  )}
                  <FieldRow icon="calendar" label="Date" value={dateLabel(d.date)} onPress={() => setPicker('date')} />
                  <FieldRow icon="repeat" label="Repeat" value={repeatSummary(d.repeat)} onPress={() => setPicker('repeat')} />
                </>
              )}

              {/* Organize */}
              <SectionHeader icon="tag" label="ORGANIZE" />
              <FieldRow
                icon="tag"
                iconColor={selTag ? selTag.color : undefined}
                label="Tag"
                value={selTag ? selTag.name : 'None'}
                valueColor={selTag ? selTag.color : C.faint}
                onPress={() => setPicker('tag')}
              />
              <FieldRow
                icon="map-pin"
                label="Place"
                value={placeName || 'None'}
                valueColor={placeName ? C.text : C.faint}
                onPress={() => setPicker('place')}
              />

              {/* Subtasks */}
              <SectionHeader icon="check-square" label="SUBTASKS" />
              {d.subtasks.map((s) => (
                <View key={s.id} style={styles.subRow}>
                  <Tappable onPress={() => toggleSub(s.id)} style={[styles.subCheck, s.done && { backgroundColor: d.color, borderColor: d.color }]}>
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

              {/* Notes */}
              <SectionHeader icon="file-text" label="NOTES" />
              <TextInput
                value={d.notes}
                onChangeText={(notes) => onPatch({ notes })}
                placeholder="Add notes…"
                placeholderTextColor={C.faint}
                multiline
                style={styles.notes}
              />
            </ScrollView>

            {/* Footer actions — pinned below the scroll */}
            <View style={styles.actions}>
              {isEditing && (
                <Tappable onPress={onDelete} style={styles.delete}>
                  <Feather name="trash-2" size={18} color={C.danger} />
                </Tappable>
              )}
              {canSave ? (
                <Tappable onPress={attemptSave} style={[styles.saveWrap, styles.saveShadow]}>
                  <LinearGradient colors={[C.accentA, C.accentB]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.save}>
                    <Text style={styles.saveTxt}>{isEditing ? 'Save changes' : 'Add task'}</Text>
                  </LinearGradient>
                </Tappable>
              ) : (
                <Tappable onPress={attemptSave} style={[styles.saveWrap, styles.saveDisabled]}>
                  <View style={styles.save}>
                    <Text style={[styles.saveTxt, { color: C.muted }]}>{isEditing ? 'Save changes' : 'Add task'}</Text>
                  </View>
                </Tappable>
              )}
            </View>
          </>
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
            <Text style={styles.pickerSection}>COLOR</Text>
            <View style={styles.wrapRow}>
              {COLORS.map((c) => (
                <Tappable
                  key={c}
                  onPress={() => onPatch({ color: c })}
                  style={[styles.swatch, { backgroundColor: c, boxShadow: d.color === c ? `0 0 0 3px ${C.sheet}, 0 0 0 5px ${c}` : undefined }]}
                />
              ))}
            </View>
            <Text style={styles.pickerSection}>ICON</Text>
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

      <TimePickerPopup visible={picker === 'start'} title="Start time" value={d?.start ?? 0} presets={gTime} tagPresets={tTime} tagName={topTagName} clock={clock} onChange={(v) => onPatch({ start: v })} onClose={() => setPicker(null)} />
      <TimePickerPopup visible={picker === 'end'} title="End time" value={end} presets={gTime} tagPresets={tTime} tagName={topTagName} clock={clock} onChange={(v) => d && onPatch({ dur: Math.max(5, v - d.start) })} onClose={() => setPicker(null)} />
      <DurationPickerPopup visible={picker === 'dur'} value={d?.dur ?? 30} presets={gDur} tagPresets={tDur} tagName={topTagName} onChange={(v) => onPatch({ dur: v })} onClose={() => setPicker(null)} />
      <DatePickerPopup visible={picker === 'date'} value={d?.date || todayKey()} weekStart={weekStart} onChange={(key) => onPatch({ date: key })} onClose={() => setPicker(null)} />
      <SelectPopup visible={picker === 'tag'} title="Select tag" options={tagOptions} selectedId={d?.tagId ?? null} emptyText="No tags yet — add some in Settings." onSelect={(id) => onPatch({ tagId: id })} onClose={() => setPicker(null)} />
      <PlaceSelectPopup visible={picker === 'place'} places={places} tags={tags} selectedId={d?.placeId ?? null} taskTagId={d?.tagId ?? null} onSelect={(id) => onPatch({ placeId: id })} onClose={() => setPicker(null)} />
      <RepeatPopup visible={picker === 'repeat'} repeat={d?.repeat ?? null} baseDate={d?.date || todayKey()} weekStart={weekStart} onChange={(r) => onPatch({ repeat: r })} onClose={() => setPicker(null)} />
    </>
  );
}

function SectionHeader({ icon, label }: { icon: keyof typeof Feather.glyphMap; label: string }) {
  return (
    <View style={styles.sectionHead}>
      <Feather name={icon} size={13} color={C.muted} />
      <Text style={styles.sectionTxt}>{label}</Text>
      <View style={styles.sectionLine} />
    </View>
  );
}

function FieldRow({
  icon,
  label,
  value,
  onPress,
  valueColor,
  iconColor,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: string;
  onPress: () => void;
  valueColor?: string;
  iconColor?: string;
}) {
  return (
    <Tappable style={styles.row} onPress={onPress}>
      <View style={styles.rowIcon}>
        <Feather name={icon} size={15} color={iconColor || C.textDim} />
      </View>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, { color: valueColor || C.text }]} numberOfLines={1}>
        {value}
      </Text>
      <Feather name="chevron-right" size={18} color={C.faint} />
    </Tappable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  headerTitle: { fontSize: 19, fontWeight: '700', color: C.text },
  closeBtn: { width: 34, height: 34, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },

  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  marker: { width: 50, height: 50, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  markerTxt: { fontSize: 23 },
  markerEdit: { position: 'absolute', right: -3, bottom: -3, width: 18, height: 18, borderRadius: 9, backgroundColor: C.sheet, alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.15)' },
  titleInput: { color: C.text, fontSize: 20, fontWeight: '700', padding: 0, paddingBottom: 4, boxShadow: `inset 0 -1px 0 0 rgba(255,255,255,0.1)` },
  titleInputErr: { boxShadow: `inset 0 -1.5px 0 0 ${C.danger}` },
  errHint: { color: C.danger, fontSize: 12, fontWeight: '600', marginTop: 6 },

  segment: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  segBtn: { flex: 1, height: 44, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.05)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  segBtnOn: { backgroundColor: C.accentB },
  segTxt: { fontSize: 13.5, fontWeight: '700' },

  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 22, marginBottom: 11 },
  sectionTxt: { fontSize: 11.5, color: C.muted, fontWeight: '700', letterSpacing: 0.6 },
  sectionLine: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.07)', marginLeft: 4 },

  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  timeCard: { flex: 1, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center' },
  timeLabel: { fontSize: 10.5, color: C.muted, fontWeight: '700', letterSpacing: 0.5, marginBottom: 4 },
  timeVal: { fontSize: 20, fontWeight: '800', color: C.text, fontVariant: ['tabular-nums'] },

  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, paddingVertical: 13, paddingHorizontal: 14, marginBottom: 10 },
  rowIcon: { width: 30, height: 30, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flex: 1, fontSize: 15, fontWeight: '600', color: C.textDim },
  rowValue: { fontSize: 15, fontWeight: '700', maxWidth: '52%', fontVariant: ['tabular-nums'] },

  subRow: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 8 },
  subCheck: { width: 24, height: 24, borderRadius: 8, borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  subInput: { flex: 1, color: C.text, fontSize: 15, paddingVertical: 7, paddingHorizontal: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 10 },
  subDone: { color: C.faint, textDecorationLine: 'line-through' },
  subX: { padding: 4 },
  addSub: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, alignSelf: 'flex-start' },
  addSubTxt: { fontSize: 14, fontWeight: '700', color: C.accentA },

  notes: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, padding: 14, color: C.text, fontSize: 15, minHeight: 84, textAlignVertical: 'top' },

  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  delete: { width: 54, height: 54, borderRadius: 16, backgroundColor: 'rgba(248,103,122,0.14)', alignItems: 'center', justifyContent: 'center' },
  saveWrap: { flex: 1, borderRadius: 16, overflow: 'hidden' },
  saveShadow: { boxShadow: `0 8px 24px -8px ${hexA('#7c7cf0', 0.7)}` },
  saveDisabled: { backgroundColor: 'rgba(255,255,255,0.06)' },
  save: { height: 54, alignItems: 'center', justifyContent: 'center' },
  saveTxt: { fontSize: 16, fontWeight: '700', color: '#0b0b0d' },

  pickerTitle: { fontSize: 17, fontWeight: '700', color: C.text, marginBottom: 14 },
  pickerSection: { fontSize: 11, color: C.muted, fontWeight: '600', marginTop: 12, marginBottom: 9 },
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
