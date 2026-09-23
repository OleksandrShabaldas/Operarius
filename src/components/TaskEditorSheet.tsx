import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { KeyboardAwareScrollView, KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { C } from '../theme';
import { ms, sp } from '../motion';
import { Clock, Draft, Place, Preset, Reminders, Tag, Task, TaskType } from '../types';
import { dateLabel, fmt, fmtDur, findTag, genId, hexA, repeatSummary, tagLabel, todayKey } from '../utils';
import { carryReminders, reminderSummary } from '../reminders';
import { ReminderPopup } from './ReminderPopup';
import { INTENSITY } from './ReminderBits';
import { CustomColorGrid, CustomIconInput, IconGrid, PaletteRow } from './ColorIcon';
import { Anchor, DAY_END_ID, DAY_START_ID, DatePickerPopup, DurationPickerPopup, Neighbor, SelectPopup, TimePickerPopup } from './pickers';
import { RepeatPopup } from './RepeatPopup';
import { PlaceSelectPopup } from './PlaceSelectPopup';
import { BottomSheet, CenterPopup } from './Overlay';
import { Appear, Tappable } from './anim';

export type Sibling = { id: string; start: number; dur: number; title: string; color: string };

type Props = {
  draft: Draft | null;
  library: Task[]; // every task — the source of name suggestions
  initialTouched?: (keyof Draft)[]; // fields the opener set on purpose (a suggestion won't override them)
  tags: Tag[];
  places: Place[];
  clock: Clock;
  weekStart: 'mon' | 'sun';
  timePresets: Preset[];
  durationPresets: Preset[];
  colors: string[];
  emojis: string[];
  siblings?: Sibling[]; // other planned tasks on the same day (for pinning start / end)
  dayStart?: number; // visible day window — the day-edge anchors
  dayEnd?: number;
  autoPickDate?: boolean; // open straight into the date picker (used when copying)
  onPatch: (patch: Partial<Draft>) => void;
  onSave: () => void;
  onDelete: () => void;
  onClose: () => void;
};

type Picker = 'icon' | 'start' | 'end' | 'dur' | 'date' | 'tag' | 'place' | 'repeat' | 'remind' | null;

const TYPES: { id: TaskType; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { id: 'planned', label: 'Planned', icon: 'clock' },
  { id: 'allday', label: 'All-day', icon: 'sun' },
  { id: 'todo', label: 'To-do', icon: 'check-circle' },
];

const FOOTER_H = 66; // Save row + its top margin
const DAY_MAX = 24 * 60;

export function TaskEditorSheet({
  draft,
  library,
  initialTouched,
  tags,
  places,
  clock,
  weekStart,
  timePresets,
  durationPresets,
  colors,
  emojis,
  siblings,
  dayStart = 0,
  dayEnd = DAY_MAX,
  autoPickDate,
  onPatch,
  onSave,
  onDelete,
  onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  const visible = !!draft;
  const [picker, setPicker] = useState<Picker>(null);
  const [iconPage, setIconPage] = useState<'main' | 'color' | 'icon'>('main');
  const [attempted, setAttempted] = useState(false);
  const [nameFocused, setNameFocused] = useState(false);
  const [usedName, setUsedName] = useState<string | null>(null); // a suggestion was applied for this name
  const [anchors, setAnchors] = useState<{ start: Anchor | null; end: Anchor | null }>({ start: null, end: null });
  const nameRef = useRef<TextInput>(null);
  const subRefs = useRef<Record<string, TextInput | null>>({});
  const focusSub = useRef<string | null>(null);
  // Fields changed by hand in this editing session.
  const touched = useRef<Set<keyof Draft>>(new Set());

  useEffect(() => {
    setIconPage('main');
  }, [picker]);

  useEffect(() => {
    if (visible) {
      setAttempted(false);
      setUsedName(null);
      setAnchors({ start: null, end: null });
      touched.current = new Set(initialTouched ?? []);
      setPicker(autoPickDate ? 'date' : null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, draft?.id]);

  // New task → straight into the name, keyboard up (once the sheet has landed).
  useEffect(() => {
    if (visible && !draft?.id && !autoPickDate) {
      const t = setTimeout(() => nameRef.current?.focus(), ms(320) + 40);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, draft?.id]);

  // Keep the last draft (and its day's tasks) during the close animation so
  // the content — pins included — still renders exactly as it was.
  const dRef = useRef<Draft | null>(draft);
  const sibRef = useRef(siblings);
  if (draft) {
    dRef.current = draft;
    sibRef.current = siblings;
  }
  const d = draft ?? dRef.current;
  const daySibs = draft ? siblings : sibRef.current;
  const isEditing = !!d?.id;
  const end = d ? d.start + d.dur : 0;
  const canSave = !!d?.title.trim();

  // A change made by hand: remembered, so a name suggestion won't undo it.
  const patch = (p: Partial<Draft>) => {
    (Object.keys(p) as (keyof Draft)[]).forEach((k) => touched.current.add(k));
    onPatch(p);
  };

  // Focus a subtask input right after it's added.
  useEffect(() => {
    if (focusSub.current) {
      const id = focusSub.current;
      focusSub.current = null;
      setTimeout(() => subRefs.current[id]?.focus(), 30);
    }
  });

  // Group sub-tags under their parent so both are selectable in the picker.
  const tagOptions: { id: string; label: string }[] = [];
  tags
    .filter((t) => !t.parentId)
    .forEach((top) => {
      tagOptions.push({ id: top.id, label: top.name });
      tags.filter((t) => t.parentId === top.id).forEach((sub) => tagOptions.push({ id: sub.id, label: '    ↳  ' + tagLabel(sub) }));
    });
  const selTag = d ? findTag(tags, d.tagId) : null;
  const topTagId = selTag ? selTag.parentId ?? selTag.id : null;
  const topTagName = topTagId ? tags.find((t) => t.id === topTagId)?.name ?? null : null;
  const gTime = timePresets.filter((p) => p.tagId == null).map((p) => p.value);
  const tTime = topTagId ? timePresets.filter((p) => p.tagId === topTagId).map((p) => p.value) : [];
  const gDur = durationPresets.filter((p) => p.tagId == null).map((p) => p.value);
  const tDur = topTagId ? durationPresets.filter((p) => p.tagId === topTagId).map((p) => p.value) : [];

  // ---- Pinning start / end to other tasks ----------------------------------
  const startMin = d?.start ?? 0;
  const endMin = startMin + (d?.dur ?? 0);
  const sibs: Neighbor[] = (daySibs ?? []).map((s) => ({ id: s.id, title: s.title, start: s.start, end: s.start + s.dur, color: s.color }));
  const edgeStart: Neighbor = { id: DAY_START_ID, title: 'Day start', start: dayStart, end: dayStart, color: C.faint };
  const edgeEnd: Neighbor = { id: DAY_END_ID, title: 'Day end', start: dayEnd, end: dayEnd, color: C.faint };
  const findN = (id: string) => (id === DAY_START_ID ? edgeStart : id === DAY_END_ID ? edgeEnd : sibs.find((s) => s.id === id) ?? null);
  // "Previous" = the latest-ending task that starts before this one and ends
  // before this one does; "next" = the earliest task starting after it.
  let prev: Neighbor | null = null;
  let next: Neighbor | null = null;
  for (const s of sibs) {
    if (s.start < startMin && s.end <= endMin) {
      if (!prev || s.end > prev.end) prev = s;
    } else if (s.start > startMin) {
      if (!next || s.start < next.start) next = s;
    }
  }
  const afterOpts = [edgeStart, ...[...sibs].sort((a, b) => a.end - b.end || a.start - b.start)];
  const untilOpts = [...[...sibs].filter((s) => s.start > startMin).sort((a, b) => a.start - b.start), edgeEnd];
  const betweenOpts = [edgeStart, ...[...sibs].sort((a, b) => a.start - b.start || a.end - b.end), edgeEnd];
  // A pin shows only while the times still match it (any manual change unpins).
  const startPin = anchors.start && findN(anchors.start.id) && findN(anchors.start.id)!.end + anchors.start.gap === startMin ? anchors.start : null;
  const endPin = anchors.end && findN(anchors.end.id) && findN(anchors.end.id)!.start - anchors.end.gap === endMin ? anchors.end : null;
  const startPinTask = startPin ? findN(startPin.id) : null;
  const endPinTask = endPin ? findN(endPin.id) : null;

  const setStartKeepDur = (s: number) => {
    if (!d) return;
    const st = Math.max(0, Math.min(DAY_MAX - 5, s));
    patch(st + d.dur > DAY_MAX ? { start: st, dur: DAY_MAX - st } : { start: st });
  };

  // ---- Name suggestions -----------------------------------------------------
  // After 3+ characters, the two most recent earlier tasks whose name contains
  // what's typed (one per distinct name). Picking one fills everything from it
  // except the date and anything already set by hand here.
  const suggestions = useMemo(() => {
    if (!d || isEditing) return [];
    const q = d.title.trim().toLowerCase();
    if (q.length < 3 || usedName === d.title) return [];
    const out: Task[] = [];
    const seen = new Set<string>();
    for (let i = library.length - 1; i >= 0 && out.length < 2; i--) {
      const t = library[i];
      const key = t.title.trim().toLowerCase();
      if (!key || seen.has(key) || !key.includes(q)) continue;
      seen.add(key);
      out.push(t);
    }
    return out;
  }, [d, isEditing, library, usedName]);

  const applySuggestion = (src: Task) => {
    if (!d) return;
    const t = touched.current;
    const p: Partial<Draft> = { title: src.title.trim() };
    if (!t.has('emoji')) p.emoji = src.emoji;
    if (!t.has('color')) p.color = src.color;
    if (!t.has('type')) p.type = src.type;
    if (!t.has('start') && src.type === 'planned') p.start = src.start;
    if (!t.has('dur')) p.dur = src.dur;
    if (!t.has('tagId')) p.tagId = src.tagId;
    if (!t.has('placeId')) p.placeId = src.placeId;
    if (!t.has('notes')) p.notes = src.notes;
    if (!t.has('subtasks')) p.subtasks = src.subtasks.map((s) => ({ id: genId(), title: s.title, done: false }));
    if (!t.has('repeat')) p.repeat = src.repeat ? { ...src.repeat, weekdays: [...src.repeat.weekdays] } : null;
    if (!t.has('reminders')) p.reminders = carryReminders(src.reminders);
    onPatch(p);
    setUsedName(p.title!);
    Haptics.selectionAsync().catch(() => {});
  };

  // ---- Subtasks ---------------------------------------------------------------
  const addSubtask = () => {
    if (!d) return;
    const id = genId();
    focusSub.current = id;
    patch({ subtasks: [...d.subtasks, { id, title: '', done: false }] });
  };
  const patchSubtask = (id: string, title: string) => d && patch({ subtasks: d.subtasks.map((s) => (s.id === id ? { ...s, title } : s)) });
  const toggleSub = (id: string) => d && patch({ subtasks: d.subtasks.map((s) => (s.id === id ? { ...s, done: !s.done } : s)) });
  const removeSub = (id: string) => d && patch({ subtasks: d.subtasks.filter((s) => s.id !== id) });
  // Return on a subtask: next one, or a fresh row after the last (if not empty).
  const submitSub = (i: number) => {
    if (!d) return;
    const nextSub = d.subtasks[i + 1];
    if (nextSub) subRefs.current[nextSub.id]?.focus();
    else if (d.subtasks[i]?.title.trim()) addSubtask();
    else subRefs.current[d.subtasks[i].id]?.blur();
  };

  const attemptSave = () => {
    if (!canSave) {
      setAttempted(true);
      nameRef.current?.focus();
      return;
    }
    onSave();
  };

  const place = d?.placeId ? places.find((p) => p.id === d.placeId) ?? null : null;

  return (
    <>
      <BottomSheet open={visible} onClose={onClose} height="88%">
        {d && (
          <>
            <View style={styles.header}>
              <Text style={styles.headerTitle}>{isEditing ? 'Edit task' : 'New task'}</Text>
              <Tappable onPress={onClose} hitSlop={8} style={styles.closeBtn}>
                <Feather name="x" size={20} color={C.textDim} />
              </Tappable>
            </View>

            <KeyboardAwareScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              bounces={false}
              bottomOffset={FOOTER_H + 30}
              extraKeyboardSpace={FOOTER_H + 10}
              contentContainerStyle={{ paddingBottom: 8 }}>
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
                    onFocus={() => setNameFocused(true)}
                    onBlur={() => setNameFocused(false)}
                    returnKeyType="done"
                    placeholder="Task name"
                    placeholderTextColor={C.faint}
                    style={[styles.titleInput, attempted && !canSave ? styles.titleInputErr : null]}
                  />
                  {attempted && !canSave && <Text style={styles.errHint}>Give your task a name to continue</Text>}
                </View>
              </View>

              {nameFocused && suggestions.length > 0 && (
                <Suggestions items={suggestions} query={d.title.trim()} tags={tags} clock={clock} onPick={applySuggestion} />
              )}

              {/* Type */}
              <View style={styles.segment}>
                {TYPES.map((t) => {
                  const on = d.type === t.id;
                  return (
                    <Tappable key={t.id} onPress={() => patch({ type: t.id })} style={[styles.segBtn, on && styles.segBtnOn]}>
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
                        <Tappable style={[styles.timeCard, startPin ? styles.timeCardPinned : null]} onPress={() => setPicker('start')}>
                          <Text style={styles.timeLabel}>START</Text>
                          <Text style={styles.timeVal}>{fmt(d.start, clock)}</Text>
                          {startPinTask && <PinHint key={`s-${startPinTask.id}`} text={`after ${startPinTask.title}`} />}
                        </Tappable>
                        <Feather name="arrow-right" size={18} color={C.faint} />
                        <Tappable style={[styles.timeCard, endPin ? styles.timeCardPinned : null]} onPress={() => setPicker('end')}>
                          <Text style={styles.timeLabel}>END</Text>
                          <Text style={styles.timeVal}>{fmt(end, clock)}</Text>
                          {endPinTask && <PinHint key={`e-${endPinTask.id}`} text={`until ${endPinTask.title}`} />}
                        </Tappable>
                      </View>
                      <FieldRow icon="watch" label="Duration" value={fmtDur(d.dur)} onPress={() => setPicker('dur')} />
                    </>
                  )}
                  <FieldRow icon="calendar" label="Date" value={dateLabel(d.date)} onPress={() => setPicker('date')} />
                  <FieldRow icon="repeat" label="Repeat" value={repeatSummary(d.repeat)} onPress={() => setPicker('repeat')} />
                </>
              )}

              {/* Reminders */}
              <SectionHeader icon="bell" label="REMINDERS" />
              <ReminderField r={d.reminders} type={d.type} clock={clock} onPress={() => setPicker('remind')} />

              {/* Organize */}
              <SectionHeader icon="tag" label="ORGANIZE" />
              <FieldRow
                icon="tag"
                iconColor={selTag ? selTag.color : undefined}
                label="Tag"
                value={selTag ? tagLabel(selTag) : 'None'}
                valueColor={selTag ? selTag.color : C.faint}
                onPress={() => setPicker('tag')}
              />
              <FieldRow icon="map-pin" label="Place" value={place?.name || 'None'} valueColor={place ? C.text : C.faint} onPress={() => setPicker('place')} />

              {/* Subtasks */}
              <SectionHeader icon="check-square" label="SUBTASKS" />
              {d.subtasks.map((s, i) => (
                <Appear key={s.id} from="up" distance={8}>
                  <View style={styles.subRow}>
                    <Tappable onPress={() => toggleSub(s.id)} style={[styles.subCheck, s.done && { backgroundColor: d.color, borderColor: d.color }]}>
                      {s.done && <Feather name="check" size={13} color="#0b0b0d" />}
                    </Tappable>
                    <TextInput
                      ref={(r) => {
                        subRefs.current[s.id] = r;
                      }}
                      value={s.title}
                      onChangeText={(t) => patchSubtask(s.id, t)}
                      onSubmitEditing={() => submitSub(i)}
                      submitBehavior="submit"
                      returnKeyType={i === d.subtasks.length - 1 ? 'done' : 'next'}
                      placeholder="Subtask"
                      placeholderTextColor={C.faint}
                      style={[styles.subInput, s.done && styles.subDone]}
                    />
                    <Tappable onPress={() => removeSub(s.id)} hitSlop={8} style={styles.subX}>
                      <Feather name="x" size={15} color={C.faint} />
                    </Tappable>
                  </View>
                </Appear>
              ))}
              <Tappable onPress={addSubtask} style={styles.addSub}>
                <Feather name="plus" size={15} color={C.accentA} />
                <Text style={styles.addSubTxt}>Add subtask</Text>
              </Tappable>

              {/* Notes */}
              <SectionHeader icon="file-text" label="NOTES" />
              <TextInput value={d.notes} onChangeText={(notes) => patch({ notes })} placeholder="Add notes…" placeholderTextColor={C.faint} multiline style={styles.notes} />
            </KeyboardAwareScrollView>

            {/* Footer actions — pinned below the scroll, and riding just above
                the keyboard while typing so Save is always one tap away. */}
            <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom + 14 }}>
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
            </KeyboardStickyView>
          </>
        )}
      </BottomSheet>

      {/* Icon + color picker: one full row of colours, two full rows of icons */}
      <CenterPopup open={picker === 'icon'} onClose={() => setPicker(null)}>
        {d && iconPage === 'main' && (
          <Appear key="main" from="left" distance={16}>
            <Text style={styles.pickerTitle}>Icon &amp; color</Text>
            <View style={styles.previewRow}>
              <MarkerPreview color={d.color} emoji={d.emoji} />
              <Text style={styles.previewName} numberOfLines={1}>
                {d.title.trim() || 'New task'}
              </Text>
            </View>
            <Text style={styles.pickerSection}>COLOR</Text>
            <PaletteRow colors={colors} value={d.color} onPick={(c) => patch({ color: c })} onCustom={() => setIconPage('color')} />
            <Text style={[styles.pickerSection, { marginTop: 18 }]}>ICON</Text>
            <IconGrid icons={emojis} value={d.emoji} onPick={(e) => patch({ emoji: e })} onCustom={() => setIconPage('icon')} />
            <Tappable onPress={() => setPicker(null)} style={[styles.pickerDone, { marginTop: 18 }]}>
              <Text style={styles.pickerDoneTxt}>Done</Text>
            </Tappable>
          </Appear>
        )}
        {d && iconPage === 'color' && (
          <Appear key="color" from="right" distance={16}>
            <PageHead title="Custom color" onBack={() => setIconPage('main')} />
            <CustomColorGrid value={d.color} onPick={(hex) => patch({ color: hex })} />
            <Tappable onPress={() => setIconPage('main')} style={styles.pickerDone}>
              <Text style={styles.pickerDoneTxt}>Done</Text>
            </Tappable>
          </Appear>
        )}
        {d && iconPage === 'icon' && (
          <Appear key="icon" from="right" distance={16}>
            <PageHead title="Custom icon" onBack={() => setIconPage('main')} />
            <CustomIconInput value={d.emoji} onChange={(v) => patch({ emoji: v })} />
            <Text style={styles.pickerHint}>Type or paste any emoji, or up to two letters.</Text>
            <Tappable onPress={() => setIconPage('main')} style={styles.pickerDone}>
              <Text style={styles.pickerDoneTxt}>Done</Text>
            </Tappable>
          </Appear>
        )}
      </CenterPopup>

      <TimePickerPopup
        visible={picker === 'start'}
        title="Start time"
        value={d?.start ?? 0}
        presets={gTime}
        tagPresets={tTime}
        tagName={topTagName}
        clock={clock}
        onChange={(v) => patch({ start: v })}
        anchor={
          d?.type === 'planned'
            ? {
                kind: 'after',
                options: afterOpts,
                preferred: prev?.id ?? DAY_START_ID,
                active: startPin,
                start: startMin,
                dur: d.dur,
                onApply: (a, time) => {
                  setStartKeepDur(time);
                  setAnchors((s) => ({ ...s, start: a }));
                },
              }
            : undefined
        }
        onClose={() => setPicker(null)}
      />
      <TimePickerPopup
        visible={picker === 'end'}
        title="End time"
        value={end}
        presets={gTime}
        tagPresets={tTime}
        tagName={topTagName}
        clock={clock}
        onChange={(v) => d && patch({ dur: Math.max(5, v - d.start) })}
        anchor={
          d?.type === 'planned'
            ? {
                kind: 'until',
                options: untilOpts,
                preferred: next?.id ?? DAY_END_ID,
                active: endPin,
                start: startMin,
                dur: d.dur,
                onApply: (a, time) => {
                  patch({ dur: Math.max(5, time - startMin) });
                  setAnchors((s) => ({ ...s, end: a }));
                },
              }
            : undefined
        }
        onClose={() => setPicker(null)}
      />
      <DurationPickerPopup
        visible={picker === 'dur'}
        value={d?.dur ?? 30}
        presets={gDur}
        tagPresets={tDur}
        tagName={topTagName}
        clock={clock}
        between={{
          options: betweenOpts,
          active: { after: startPin, until: endPin },
          onApply: (a, u, s, e) => {
            patch({ start: s, dur: Math.max(5, e - s) });
            setAnchors({ start: a, end: u });
          },
        }}
        onChange={(v) => patch({ dur: v })}
        onClose={() => setPicker(null)}
      />
      <DatePickerPopup visible={picker === 'date'} value={d?.date || todayKey()} weekStart={weekStart} onChange={(key) => onPatch({ date: key })} onClose={() => setPicker(null)} />
      <SelectPopup visible={picker === 'tag'} title="Select tag" options={tagOptions} selectedId={d?.tagId ?? null} emptyText="No tags yet — add some in Settings." onSelect={(id) => patch({ tagId: id })} onClose={() => setPicker(null)} />
      <PlaceSelectPopup visible={picker === 'place'} places={places} tags={tags} selectedId={d?.placeId ?? null} taskTagId={d?.tagId ?? null} onSelect={(id) => patch({ placeId: id })} onClose={() => setPicker(null)} />
      <RepeatPopup visible={picker === 'repeat'} repeat={d?.repeat ?? null} baseDate={d?.date || todayKey()} weekStart={weekStart} onChange={(r) => patch({ repeat: r })} onClose={() => setPicker(null)} />
      <ReminderPopup visible={picker === 'remind'} draft={draft} onChange={(r) => patch({ reminders: r })} onClose={() => setPicker(null)} />
    </>
  );
}

// The "Remind me" row: what's set (and how insistent), or Off.
function ReminderField({ r, type, clock, onPress }: { r: Reminders | null; type: TaskType; clock: Clock; onPress: () => void }) {
  const parts = reminderSummary(r, type, clock);
  const on = parts.length > 0 && !!r;
  const m = r ? INTENSITY[r.intensity] : null;
  const text = on ? parts.slice(0, 2).join(', ') + (parts.length > 2 ? `  +${parts.length - 2}` : '') : 'Off';
  return (
    <Tappable style={styles.row} onPress={onPress}>
      <View style={[styles.rowIcon, on && m ? { backgroundColor: hexA(m.color, 0.15) } : null]}>
        <Feather name={on ? 'bell' : 'bell-off'} size={15} color={on && m ? m.color : C.textDim} />
      </View>
      <Text style={styles.rowLabel}>Remind me</Text>
      <View style={styles.remVal}>
        <Text style={[styles.rowValue, styles.remValTxt, { color: on ? C.text : C.faint }]} numberOfLines={1}>
          {text}
        </Text>
        {on && m && (
          <Appear key={r!.intensity} from="up" distance={5}>
            <Text style={[styles.remSub, { color: m.color }]}>{m.label}</Text>
          </Appear>
        )}
      </View>
      <Feather name="chevron-right" size={18} color={C.faint} />
    </Tappable>
  );
}

// Suggestions under the name field: earlier tasks with a matching name.
function Suggestions({ items, query, tags, clock, onPick }: { items: Task[]; query: string; tags: Tag[]; clock: Clock; onPick: (t: Task) => void }) {
  return (
    <Appear from="down" distance={8} style={styles.sugBox}>
      <View style={styles.sugHead}>
        <Feather name="rotate-ccw" size={11} color={C.muted} />
        <Text style={styles.sugHeadTxt}>FROM EARLIER TASKS</Text>
      </View>
      {items.map((t, i) => {
        const tag = findTag(tags, t.tagId);
        const meta = [t.type === 'planned' ? `${fmt(t.start, clock)} · ${fmtDur(t.dur)}` : t.type === 'allday' ? 'All-day' : 'To-do', tag ? tagLabel(tag) : null, t.subtasks.length ? `${t.subtasks.length} subtask${t.subtasks.length > 1 ? 's' : ''}` : null]
          .filter(Boolean)
          .join('  ·  ');
        return (
          <Appear key={t.id} delay={40 + i * 50} from="up" distance={8}>
            <Tappable onPress={() => onPick(t)} style={styles.sugRow}>
              <LinearGradient colors={[t.color, hexA(t.color, 0.75)]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={styles.sugIcon}>
                <Text style={styles.sugEmoji}>{t.emoji}</Text>
              </LinearGradient>
              <View style={{ flex: 1 }}>
                <Highlighted text={t.title.trim()} query={query} />
                <Text style={styles.sugMeta} numberOfLines={1}>
                  {meta}
                </Text>
              </View>
              <View style={styles.sugUse}>
                <Feather name="corner-down-left" size={14} color={C.accentB} />
              </View>
            </Tappable>
          </Appear>
        );
      })}
    </Appear>
  );
}

// The name with the typed part emphasised.
function Highlighted({ text, query }: { text: string; query: string }) {
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0 || !query) {
    return (
      <Text style={styles.sugName} numberOfLines={1}>
        {text}
      </Text>
    );
  }
  return (
    <Text style={styles.sugName} numberOfLines={1}>
      {text.slice(0, i)}
      <Text style={styles.sugMatch}>{text.slice(i, i + query.length)}</Text>
      {text.slice(i + query.length)}
    </Text>
  );
}

// "⚡ after Standup" under a pinned start / end time.
function PinHint({ text }: { text: string }) {
  return (
    <Appear from="up" distance={6} style={styles.pinHint}>
      <Feather name="zap" size={10} color={C.accentB} />
      <Text style={styles.pinHintTxt} numberOfLines={1}>
        {text}
      </Text>
    </Appear>
  );
}

// The task marker as it will look on the card; springs a little on each change.
function MarkerPreview({ color, emoji }: { color: string; emoji: string }) {
  const s = useSharedValue(1);
  useEffect(() => {
    s.value = 0.86;
    s.value = withSpring(1, sp({ damping: 10, stiffness: 300 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [color, emoji]);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <Animated.View style={[styles.previewShadow, { boxShadow: `0 10px 24px -8px ${hexA(color, 0.75)}` }, a]}>
      <LinearGradient colors={[color, hexA(color, 0.75)]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={styles.preview}>
        <Text style={styles.previewTxt}>{emoji}</Text>
      </LinearGradient>
    </Animated.View>
  );
}

function PageHead({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={styles.pageHead}>
      <Tappable onPress={onBack} hitSlop={8} style={styles.pageBack}>
        <Feather name="chevron-left" size={20} color={C.textDim} />
      </Tappable>
      <Text style={[styles.pickerTitle, { marginBottom: 0 }]}>{title}</Text>
    </View>
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

  sugBox: { marginTop: -8, marginBottom: 16, borderRadius: 16, padding: 6, backgroundColor: 'rgba(255,255,255,0.04)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.07)' },
  sugHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingTop: 4, paddingBottom: 6 },
  sugHeadTxt: { fontSize: 10.5, fontWeight: '800', color: C.muted, letterSpacing: 0.6 },
  sugRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 8, paddingVertical: 8, borderRadius: 12 },
  sugIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  sugEmoji: { fontSize: 16 },
  sugName: { fontSize: 15, fontWeight: '600', color: C.textDim },
  sugMatch: { fontWeight: '800', color: C.text },
  sugMeta: { fontSize: 11.5, fontWeight: '600', color: C.muted, marginTop: 2, fontVariant: ['tabular-nums'] },
  sugUse: { width: 30, height: 30, borderRadius: 9, backgroundColor: 'rgba(79,209,197,0.12)', alignItems: 'center', justifyContent: 'center' },

  segment: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  segBtn: { flex: 1, height: 44, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.05)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  segBtnOn: { backgroundColor: C.accentB },
  segTxt: { fontSize: 13.5, fontWeight: '700' },

  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 22, marginBottom: 11 },
  sectionTxt: { fontSize: 11.5, color: C.muted, fontWeight: '700', letterSpacing: 0.6 },
  sectionLine: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.07)', marginLeft: 4 },

  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  // Same shadow shape in both states (a removed boxShadow can stick on Android).
  timeCard: { flex: 1, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, paddingVertical: 12, paddingHorizontal: 12, alignItems: 'center', boxShadow: 'inset 0 0 0 1px rgba(79,209,197,0)' },
  timeCardPinned: { backgroundColor: 'rgba(79,209,197,0.08)', boxShadow: 'inset 0 0 0 1px rgba(79,209,197,0.35)' },
  timeLabel: { fontSize: 10.5, color: C.muted, fontWeight: '700', letterSpacing: 0.5, marginBottom: 4 },
  timeVal: { fontSize: 20, fontWeight: '800', color: C.text, fontVariant: ['tabular-nums'] },
  pinHint: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, maxWidth: '100%' },
  pinHintTxt: { fontSize: 11, fontWeight: '700', color: C.accentB, flexShrink: 1 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, paddingVertical: 13, paddingHorizontal: 14, marginBottom: 10 },
  rowIcon: { width: 30, height: 30, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flex: 1, fontSize: 15, fontWeight: '600', color: C.textDim },
  // paddingRight: layout rounding can shave the last pixel off a content-sized
  // single-line text, and Android then ellipsizes it ("30 m…") — 1dp absorbs that.
  rowValue: { fontSize: 15, fontWeight: '700', maxWidth: '52%', fontVariant: ['tabular-nums'], paddingRight: 1 },
  remVal: { alignItems: 'flex-end', maxWidth: '56%' },
  remValTxt: { maxWidth: '100%' },
  remSub: { fontSize: 11, fontWeight: '800', marginTop: 2, letterSpacing: 0.3 },

  subRow: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 8 },
  subCheck: { width: 24, height: 24, borderRadius: 8, borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  subInput: { flex: 1, color: C.text, fontSize: 15, paddingVertical: 7, paddingHorizontal: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 10 },
  subDone: { color: C.faint, textDecorationLine: 'line-through' },
  subX: { padding: 4 },
  addSub: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, alignSelf: 'flex-start' },
  addSubTxt: { fontSize: 14, fontWeight: '700', color: C.accentA },

  notes: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, padding: 14, color: C.text, fontSize: 15, minHeight: 84, textAlignVertical: 'top' },

  actions: { flexDirection: 'row', gap: 10, marginTop: 12, backgroundColor: C.sheet },
  delete: { width: 54, height: 54, borderRadius: 16, backgroundColor: 'rgba(248,103,122,0.14)', alignItems: 'center', justifyContent: 'center' },
  saveWrap: { flex: 1, borderRadius: 16, overflow: 'hidden' },
  saveShadow: { boxShadow: `0 8px 24px -8px ${hexA('#7c7cf0', 0.7)}` },
  saveDisabled: { backgroundColor: 'rgba(255,255,255,0.06)' },
  save: { height: 54, alignItems: 'center', justifyContent: 'center' },
  saveTxt: { fontSize: 16, fontWeight: '700', color: '#0b0b0d' },

  pickerTitle: { fontSize: 17, fontWeight: '700', color: C.text, marginBottom: 14 },
  pickerSection: { fontSize: 11, color: C.muted, fontWeight: '700', letterSpacing: 0.5, marginTop: 4, marginBottom: 10 },
  pickerHint: { fontSize: 12, color: C.muted, marginTop: 12, lineHeight: 17 },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 18, paddingHorizontal: 2 },
  previewShadow: { borderRadius: 18 },
  preview: { width: 58, height: 58, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  previewTxt: { fontSize: 27 },
  previewName: { flex: 1, fontSize: 16, fontWeight: '700', color: C.textDim },
  pageHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14, marginLeft: -6 },
  pageBack: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  pickerDone: { height: 48, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  pickerDoneTxt: { fontSize: 15, fontWeight: '700', color: C.text },
});
