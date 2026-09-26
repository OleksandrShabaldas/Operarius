import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { C, COLORS, EMOJIS, ICON_SLOTS, PALETTE_SLOTS } from '../theme';
import { sp } from '../motion';
import { Tag } from '../types';
import { useApp } from '../store';
import { daysAgo, fmt, fmtDur, hexA } from '../utils';
import { fmtCoords, hasLocation } from '../maps';
import { fmtScale, MotionPreview, ScaleSlider, Toggle } from '../components/MotionSettings';
import { TextPromptModal } from '../components/TextPromptModal';
import { PlaceIcon } from '../components/PlaceIcon';
import { PlaceEditorPopup } from '../components/PlaceEditorPopup';
import { ColorSwatch, CustomColorGrid, CustomIconInput, IconCell, IconGrid, PaletteRow, SlotGrid } from '../components/ColorIcon';
import { TimePickerPopup, DurationPickerPopup } from '../components/pickers';
import { CenterPopup } from '../components/Overlay';
import { ReminderSettings } from '../components/ReminderSettings';
import { CalendarSettings } from '../components/CalendarSettings';
import { DataSettings } from '../components/DataSettings';
import { WidgetSettings } from '../components/WidgetSettings';
import { Appear, Tappable } from '../components/anim';

const Pressable = Tappable; // every tappable control gets press feedback

type Category = 'general' | 'reminders' | 'calendar' | 'widgets' | 'appearance' | 'motion' | 'tags' | 'places' | 'presets' | 'data' | 'about';
type Prompt = { title: string; initial: string; submitLabel: string; onSubmit: (t: string) => void };

const CATS: { id: Category; label: string; icon: keyof typeof Feather.glyphMap; sub: string }[] = [
  { id: 'general', label: 'General', icon: 'sliders', sub: 'Day window, week start, gaps' },
  { id: 'reminders', label: 'Reminders', icon: 'bell', sub: 'Defaults, alarm sound, reliability' },
  { id: 'calendar', label: 'Google Calendar', icon: 'calendar', sub: 'Sync tasks with your calendar' },
  { id: 'widgets', label: 'Widgets', icon: 'grid', sub: 'Today, the month, or both in one' },
  { id: 'appearance', label: 'Appearance', icon: 'droplet', sub: 'Time format, colors & icons' },
  { id: 'motion', label: 'Animations', icon: 'wind', sub: 'On / off and speed' },
  { id: 'tags', label: 'Tags', icon: 'tag', sub: 'Tags, sub-tags & week dots' },
  { id: 'places', label: 'Places', icon: 'map-pin', sub: 'Saved places' },
  { id: 'presets', label: 'Presets', icon: 'zap', sub: 'Quick time & duration picks' },
  { id: 'data', label: 'Data & backup', icon: 'database', sub: 'Export, import, clean up' },
  { id: 'about', label: 'About & updates', icon: 'info', sub: 'Version and updates' },
];

export function SettingsScreen({
  onClose,
  onCheckUpdates,
  checkingUpdates,
  currentVersion,
}: {
  onClose: () => void;
  onCheckUpdates: () => void;
  checkingUpdates: boolean;
  currentVersion: string;
}) {
  const insets = useSafeAreaInsets();
  const app = useApp();
  const {
    settings, updateSettings,
    addTag, renameTag, setTagColor, setTagHideDots, setTagIcon, deleteTag,
    addPlace, renamePlace, setPlaceTag, setPlaceLocation, setPlacePhoto, deletePlace,
  } = app;
  const [cat, setCat] = useState<Category | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [colorPick, setColorPick] = useState<string | null>(null);
  const [addPreset, setAddPreset] = useState<'time' | 'dur' | null>(null);
  const [tempPreset, setTempPreset] = useState(12 * 60);
  const [placeTab, setPlaceTab] = useState<string | null>(null); // null = Untagged
  const [presetTab, setPresetTab] = useState<string | null>(null); // null = Global
  const [placeEdit, setPlaceEdit] = useState<string | null>(null);
  const [slotEdit, setSlotEdit] = useState<{ kind: 'color' | 'icon'; index: number } | null>(null);
  const [tagColorPage, setTagColorPage] = useState<'main' | 'custom'>('main');
  const [tempColor, setTempColor] = useState('#7c7cf0');
  const [tempIcon, setTempIcon] = useState('');
  const [subIconFor, setSubIconFor] = useState<string | null>(null); // sub-tag whose icon is being picked
  const [subIconPage, setSubIconPage] = useState<'grid' | 'custom'>('grid');
  const [previewSpeed, setPreviewSpeed] = useState(settings.animSpeed); // follows the slider while dragging
  useEffect(() => setPreviewSpeed(settings.animSpeed), [settings.animSpeed]);

  // Back inside a category returns to the category list (App closes the screen).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (cat) {
        setCat(null);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [cat]);

  const confirm = (title: string, msg: string, action: () => void) =>
    Alert.alert(title, msg, [
      { text: 'Cancel', style: 'cancel' },
      { text: title, style: 'destructive', onPress: action },
    ]);

  const topTags = settings.tags.filter((t) => t.parentId == null);
  const subtagsOf = (id: string) => settings.tags.filter((t) => t.parentId === id);
  const pickedTag = colorPick ? settings.tags.find((t) => t.id === colorPick) ?? null : null;

  const title = cat ? CATS.find((c) => c.id === cat)!.label : 'Settings';

  // A category's line in the list — live where it helps (what's synced with).
  const catSub = (id: Category, sub: string) => {
    const cal = settings.calendar;
    if (id === 'calendar' && cal.on && cal.calendarName) return `On · ${cal.calendarName}`;
    if (id === 'data' && settings.lastBackup) {
      const days = daysAgo(settings.lastBackup.at);
      return `Last backup ${days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`}`;
    }
    return sub;
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.head}>
        <Pressable onPress={cat ? () => setCat(null) : onClose} hitSlop={10} style={styles.backBtn}>
          <Feather name="chevron-left" size={24} color={C.text} />
        </Pressable>
        <Text style={styles.headTitle}>{title}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 30 }} showsVerticalScrollIndicator={false}>
        {cat == null && (
          <View style={{ marginTop: 6 }}>
            {CATS.map((c) => (
              <Pressable key={c.id} style={styles.catRow} onPress={() => setCat(c.id)}>
                <View style={styles.catIcon}>
                  <Feather name={c.icon} size={18} color={C.accentB} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.catLabel}>{c.label}</Text>
                  <Text style={styles.catSub} numberOfLines={1}>
                    {catSub(c.id, c.sub)}
                  </Text>
                </View>
                {c.id === 'calendar' && settings.calendar.on && <View style={[styles.catLive, { backgroundColor: settings.calendar.lastError ? '#f5a15c' : C.accentB }]} />}
                <Feather name="chevron-right" size={20} color={C.muted} />
              </Pressable>
            ))}
          </View>
        )}

        {cat === 'general' && (
          <View style={{ marginTop: 10 }}>
            <Text style={styles.section}>DAY WINDOW</Text>
            <View style={styles.stepRow}>
              <StepCard label="START" value={fmt(settings.dayStart, settings.clock)} onDown={() => updateSettings({ dayStart: Math.max(0, settings.dayStart - 30) })} onUp={() => updateSettings({ dayStart: Math.min(settings.dayEnd - 60, settings.dayStart + 30) })} />
              <StepCard label="END" value={fmt(settings.dayEnd, settings.clock)} onDown={() => updateSettings({ dayEnd: Math.max(settings.dayStart + 60, settings.dayEnd - 30) })} onUp={() => updateSettings({ dayEnd: Math.min(24 * 60, settings.dayEnd + 30) })} />
            </View>
            <Text style={styles.section}>SHOW GAP AS A PILL WHEN ≤</Text>
            <View style={styles.stepRow}>
              <StepCard label="GAP LENGTH" value={`${settings.gapThreshold} min`} onDown={() => updateSettings({ gapThreshold: Math.max(0, settings.gapThreshold - 5) })} onUp={() => updateSettings({ gapThreshold: Math.min(60, settings.gapThreshold + 5) })} />
              <View style={{ flex: 1 }} />
            </View>
            <Text style={styles.section}>START WEEK ON</Text>
            <View style={styles.segment}>
              {(['mon', 'sun'] as const).map((w) => (
                <Pressable key={w} onPress={() => updateSettings({ weekStart: w })} style={[styles.segBtn, settings.weekStart === w && styles.segBtnOn]}>
                  <Text style={[styles.segTxt, { color: settings.weekStart === w ? '#0b0b0d' : C.textDim }]}>{w === 'mon' ? 'Monday' : 'Sunday'}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.section}>WHEN DRAGGING A TASK ONTO ANOTHER</Text>
            <View style={styles.segment}>
              <Pressable onPress={() => updateSettings({ swapOnDrag: false })} style={[styles.segBtn, !settings.swapOnDrag && styles.segBtnOn]}>
                <Text style={[styles.segTxt, { color: !settings.swapOnDrag ? '#0b0b0d' : C.textDim }]}>Overlap</Text>
              </Pressable>
              <Pressable onPress={() => updateSettings({ swapOnDrag: true })} style={[styles.segBtn, settings.swapOnDrag && styles.segBtnOn]}>
                <Text style={[styles.segTxt, { color: settings.swapOnDrag ? '#0b0b0d' : C.textDim }]}>Push apart</Text>
              </Pressable>
            </View>
            <Text style={styles.hint}>
              {settings.swapOnDrag
                ? 'A task dropped onto another lands right before or after it (whichever side you dropped it on), so tasks never overlap.'
                : 'A task dropped onto another keeps the exact time you chose; overlapping tasks are shown joined, with an “Overlapping” warning.'}
            </Text>
          </View>
        )}

        {cat === 'reminders' && <ReminderSettings />}

        {cat === 'calendar' && <CalendarSettings />}

        {cat === 'widgets' && <WidgetSettings />}

        {cat === 'appearance' && (
          <View style={{ marginTop: 10 }}>
            <Text style={styles.section}>TIME FORMAT</Text>
            <View style={styles.segment}>
              {(['12h', '24h'] as const).map((f) => (
                <Pressable key={f} onPress={() => updateSettings({ clock: f })} style={[styles.segBtn, settings.clock === f && styles.segBtnOn]}>
                  <Text style={[styles.segTxt, { color: settings.clock === f ? '#0b0b0d' : C.textDim }]}>{f === '12h' ? '12-hour' : '24-hour'}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.section}>TASK COLORS</Text>
            <View style={styles.slotCard}>
              <SlotGrid
                items={[...settings.colors, null]}
                cols={PALETTE_SLOTS + 1}
                maxSize={38}
                gutter={6}
                renderCell={(c, i, size) =>
                  c ? (
                    <ColorSwatch key={`${i}-${c}`} color={c} size={size} selected={false} delay={40 + i * 22} onPress={() => { setTempColor(c); setSlotEdit({ kind: 'color', index: i }); }} />
                  ) : (
                    <ResetTile round size={size} delay={40 + i * 22} onPress={() => confirm('Reset', 'Reset the palette to the default colors?', () => updateSettings({ colors: [...COLORS] }))} />
                  )
                }
              />
            </View>
            <Text style={styles.hint}>Tap a color to change it. These {PALETTE_SLOTS} fill one row in a task's icon & color picker, next to the custom color option.</Text>

            <Text style={styles.section}>TASK ICONS</Text>
            <View style={styles.slotCard}>
              <SlotGrid
                items={[...settings.emojis, null]}
                cols={Math.ceil((ICON_SLOTS + 1) / 2)}
                maxSize={42}
                gutter={6}
                renderCell={(e, i, size) =>
                  e ? (
                    <IconCell key={`${i}-${e}`} glyph={e} size={size} selected={false} delay={60 + i * 16} onPress={() => { setTempIcon(e); setSlotEdit({ kind: 'icon', index: i }); }} />
                  ) : (
                    <ResetTile size={size} delay={60 + i * 16} onPress={() => confirm('Reset', 'Reset the icon set to the defaults?', () => updateSettings({ emojis: [...EMOJIS] }))} />
                  )
                }
              />
            </View>
            <Text style={styles.hint}>Tap an icon to swap it for any emoji or up to two letters. They fill two rows in the picker, next to the custom icon option.</Text>
          </View>
        )}

        {cat === 'motion' && (
          <View style={{ marginTop: 10 }}>
            <Appear from="up" delay={20} style={styles.toggleRow}>
              <View style={styles.toggleIcon}>
                <Feather name="wind" size={17} color={C.accentB} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleTitle}>Animations</Text>
                <Text style={styles.toggleSub}>{settings.animations ? 'Smooth motion on every tap, sheet and screen' : 'Everything changes instantly'}</Text>
              </View>
              <Toggle value={settings.animations} onChange={(v) => updateSettings({ animations: v })} />
            </Appear>

            <Text style={styles.section}>ANIMATION SPEED</Text>
            <Appear from="up" delay={70} style={[styles.scaleCard, !settings.animations && { opacity: 0.55 }]}>
              <View style={styles.scaleHead}>
                <Text style={styles.scaleVal}>{fmtScale(previewSpeed)}</Text>
                <Text style={styles.scaleCap}>{speedCaption(previewSpeed)}</Text>
                <View style={{ flex: 1 }} />
                {settings.animSpeed !== 1 && settings.animations && (
                  <Appear from="pop">
                    <Pressable onPress={() => updateSettings({ animSpeed: 1 })} style={styles.scaleReset} hitSlop={6}>
                      <Feather name="rotate-ccw" size={12} color={C.accentB} />
                      <Text style={styles.scaleResetTxt}>1×</Text>
                    </Pressable>
                  </Appear>
                )}
              </View>
              <ScaleSlider value={settings.animSpeed} disabled={!settings.animations} onPreview={setPreviewSpeed} onChange={(v) => updateSettings({ animSpeed: v })} />
            </Appear>
            <Text style={styles.hint}>How fast every animation plays — 0.5× at half speed, 4× four times faster. Springs keep their bounce.</Text>

            <Text style={styles.section}>PREVIEW</Text>
            <Appear from="up" delay={120}>
              <MotionPreview speed={previewSpeed} enabled={settings.animations} />
            </Appear>
          </View>
        )}

        {cat === 'tags' && (
          <View style={{ marginTop: 10 }}>
            {topTags.map((tag: Tag, ti) => (
              <Appear key={tag.id} from="up" delay={30 + ti * 40} style={styles.manageBlock}>
                <View style={styles.manageRow}>
                  <Pressable onPress={() => { setTagColorPage('main'); setColorPick(tag.id); }} style={[styles.tagSwatch, { backgroundColor: tag.color }]} />
                  <Pressable style={styles.manageName} onPress={() => setPrompt({ title: 'Rename tag', initial: tag.name, submitLabel: 'Save', onSubmit: (t) => renameTag(tag.id, t) })}>
                    <Text style={[styles.manageNameTxt, tag.hideDots && styles.nameHidden]} numberOfLines={1}>{tag.name}</Text>
                  </Pressable>
                  <DotsToggle hidden={!!tag.hideDots} onPress={() => setTagHideDots(tag.id, !tag.hideDots)} />
                  <Pressable hitSlop={6} style={styles.smallBtn} onPress={() => setPrompt({ title: `New sub-tag in "${tag.name}"`, initial: '', submitLabel: 'Add', onSubmit: (t) => addTag(t, tag.id) })}>
                    <Text style={styles.smallBtnTxt}>＋ sub</Text>
                  </Pressable>
                  <Pressable hitSlop={6} style={styles.iconBtn} onPress={() => confirm('Delete', `Delete "${tag.name}" and its sub-tags?`, () => deleteTag(tag.id))}>
                    <Feather name="trash-2" size={15} color={C.danger} />
                  </Pressable>
                </View>
                {subtagsOf(tag.id).length > 0 && (
                  <View style={styles.subWrap}>
                    {subtagsOf(tag.id).map((st) => {
                      const inherited = !!tag.hideDots;
                      const hidden = inherited || !!st.hideDots;
                      return (
                        <View key={st.id} style={styles.subChip}>
                          {/* Sub-tags share the parent's colour; an icon tells them apart. */}
                          <Pressable hitSlop={6} onPress={() => { setSubIconPage('grid'); setSubIconFor(st.id); }} style={[styles.subIcon, !st.icon && styles.subIconEmpty, { boxShadow: `inset 0 0 0 1px ${st.icon ? 'rgba(255,255,255,0.1)' : hexA(tag.color, 0.5)}` }]}>
                            {st.icon ? <Text style={styles.subIconTxt}>{st.icon}</Text> : <Feather name="plus" size={11} color={tag.color} />}
                          </Pressable>
                          <Pressable onPress={() => setPrompt({ title: 'Rename sub-tag', initial: st.name, submitLabel: 'Save', onSubmit: (t) => renameTag(st.id, t) })}>
                            <Text style={[styles.subChipTxt, hidden && styles.nameHidden]}>{st.name}</Text>
                          </Pressable>
                          {/* Inherited from a hidden parent: shown extra-faint and locked. */}
                          <Pressable hitSlop={8} disabled={inherited} onPress={() => setTagHideDots(st.id, !st.hideDots)}>
                            <Feather name={hidden ? 'eye-off' : 'eye'} size={13} color={inherited ? 'rgba(255,255,255,0.2)' : hidden ? C.faint : C.accentB} />
                          </Pressable>
                          <Pressable hitSlop={8} onPress={() => confirm('Delete', `Delete sub-tag "${st.name}"?`, () => deleteTag(st.id))}>
                            <Feather name="x" size={13} color={C.faint} />
                          </Pressable>
                        </View>
                      );
                    })}
                  </View>
                )}
              </Appear>
            ))}
            <Pressable style={styles.addBtn} onPress={() => setPrompt({ title: 'New tag', initial: '', submitLabel: 'Add', onSubmit: (t) => addTag(t, null) })}>
              <Text style={styles.addBtnTxt}>＋ New tag</Text>
            </Pressable>
            <View style={styles.legend}>
              <Feather name="eye" size={13} color={C.muted} />
              <Text style={styles.legendTxt}>
                The eye controls whether a tag's tasks appear as dots under the days in the week strip. Hiding a tag hides its sub-tags' tasks too.
              </Text>
            </View>
          </View>
        )}

        {cat === 'places' && (
          <View style={{ marginTop: 10 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabBar}>
              {[null, ...topTags.map((t) => t.id)].map((tid) => {
                const t = tid ? topTags.find((x) => x.id === tid) : null;
                const on = placeTab === tid;
                return (
                  <Pressable key={tid ?? 'untagged'} onPress={() => setPlaceTab(tid)} style={[styles.tab, on && (t ? { backgroundColor: t.color } : styles.tabOn)]}>
                    <Text style={[styles.tabTxt, { color: on ? '#0b0b0d' : C.textDim }]}>{t ? t.name : 'Untagged'}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View key={`pl-${placeTab ?? 'x'}`}>
              {settings.places.filter((pl) => (pl.tagId ?? null) === placeTab).map((pl, pi) => (
                <Appear key={pl.id} from="up" delay={30 + pi * 40}>
                <Pressable style={styles.placeRow} onPress={() => setPlaceEdit(pl.id)}>
                  {pl.photoUri ? (
                    <Image source={{ uri: pl.photoUri }} style={styles.placeThumb} />
                  ) : (
                    <View style={styles.placeThumbEmpty}>
                      <PlaceIcon size={16} color={C.textDim} />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.manageNameTxt}>{pl.name}</Text>
                    {hasLocation(pl) ? (
                      <View style={styles.placeMetaRow}>
                        <Feather name="map-pin" size={11} color={C.accentB} />
                        <Text style={[styles.placeMeta, { color: C.accentB }]} numberOfLines={1}>
                          {pl.address || (pl.lat != null && pl.lng != null ? fmtCoords(pl.lat, pl.lng) : 'On Google Maps')}
                        </Text>
                      </View>
                    ) : (
                      <View style={styles.placeMetaRow}>
                        <Text style={styles.placeMeta}>No location yet</Text>
                      </View>
                    )}
                  </View>
                  <Feather name="chevron-right" size={20} color={C.muted} />
                </Pressable>
                </Appear>
              ))}
              {settings.places.filter((pl) => (pl.tagId ?? null) === placeTab).length === 0 && (
                <Appear from="up">
                  <Text style={styles.emptyHint}>No places here yet.</Text>
                </Appear>
              )}
              <Pressable style={styles.addBtn} onPress={() => setPrompt({ title: 'New place', initial: '', submitLabel: 'Add', onSubmit: (t) => addPlace(t, placeTab) })}>
                <Text style={styles.addBtnTxt}>＋ New place</Text>
              </Pressable>
            </View>
          </View>
        )}

        {cat === 'presets' && (
          <View style={{ marginTop: 10 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabBar}>
              {[null, ...topTags.map((t) => t.id)].map((tid) => {
                const t = tid ? topTags.find((x) => x.id === tid) : null;
                const on = presetTab === tid;
                return (
                  <Pressable key={tid ?? 'global'} onPress={() => setPresetTab(tid)} style={[styles.tab, on && (t ? { backgroundColor: t.color } : styles.tabOn)]}>
                    <Text style={[styles.tabTxt, { color: on ? '#0b0b0d' : C.textDim }]}>{t ? t.name : 'Global'}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Appear key={`ps-${presetTab ?? 'x'}`} from="up" distance={10}>
              <Text style={styles.section}>{presetTab ? 'TIME PRESETS · TAG' : 'TIME PRESETS · GLOBAL'}</Text>
              <View style={styles.presetWrap}>
                {settings.timePresets.filter((p) => (p.tagId ?? null) === presetTab).map((p, i) => (
                  <View key={`${p.value}-${i}`} style={styles.presetChip}>
                    <Text style={styles.presetTxt}>{fmt(p.value, settings.clock)}</Text>
                    <Pressable hitSlop={8} onPress={() => updateSettings({ timePresets: settings.timePresets.filter((x) => !(x.value === p.value && (x.tagId ?? null) === presetTab)) })}>
                      <Feather name="x" size={13} color={C.faint} />
                    </Pressable>
                  </View>
                ))}
                <Pressable style={styles.presetAdd} onPress={() => { setTempPreset(12 * 60); setAddPreset('time'); }}>
                  <Feather name="plus" size={14} color={C.accentA} />
                </Pressable>
              </View>

              <Text style={styles.section}>{presetTab ? 'DURATION PRESETS · TAG' : 'DURATION PRESETS · GLOBAL'}</Text>
              <View style={styles.presetWrap}>
                {settings.durationPresets.filter((p) => (p.tagId ?? null) === presetTab).map((p, i) => (
                  <View key={`${p.value}-${i}`} style={styles.presetChip}>
                    <Text style={styles.presetTxt}>{fmtDur(p.value)}</Text>
                    <Pressable hitSlop={8} onPress={() => updateSettings({ durationPresets: settings.durationPresets.filter((x) => !(x.value === p.value && (x.tagId ?? null) === presetTab)) })}>
                      <Feather name="x" size={13} color={C.faint} />
                    </Pressable>
                  </View>
                ))}
                <Pressable style={styles.presetAdd} onPress={() => { setTempPreset(30); setAddPreset('dur'); }}>
                  <Feather name="plus" size={14} color={C.accentA} />
                </Pressable>
              </View>

              <Text style={styles.presetNote}>
                {presetTab ? 'These appear only for tasks with this tag (in addition to global presets).' : 'These appear for every task. Pick a tag tab to add tag-specific presets.'}
              </Text>
            </Appear>
          </View>
        )}

        {cat === 'data' && <DataSettings />}

        {cat === 'about' && (
          <View style={{ marginTop: 10 }}>
            <Pressable style={styles.rowBtn} onPress={onCheckUpdates} disabled={checkingUpdates}>
              <View>
                <Text style={styles.rowBtnTxt}>Check for updates</Text>
                <Text style={styles.rowSub}>Current version · v{currentVersion}</Text>
              </View>
              {checkingUpdates ? <ActivityIndicator size="small" color={C.accentB} /> : <Feather name="chevron-right" size={20} color={C.muted} />}
            </Pressable>
            <Text style={styles.about}>Operarius · v{currentVersion}</Text>
          </View>
        )}
      </ScrollView>

      <TextPromptModal
        visible={!!prompt}
        title={prompt?.title || ''}
        initial={prompt?.initial || ''}
        submitLabel={prompt?.submitLabel || 'Save'}
        placeholder="Name"
        onSubmit={(t) => { prompt?.onSubmit(t); setPrompt(null); }}
        onCancel={() => setPrompt(null)}
      />
      <TimePickerPopup
        visible={addPreset === 'time'}
        title="Add time preset"
        value={tempPreset}
        presets={[]}
        clock={settings.clock}
        onChange={setTempPreset}
        onClose={() => {
          const exists = settings.timePresets.some((p) => p.value === tempPreset && (p.tagId ?? null) === presetTab);
          if (!exists) updateSettings({ timePresets: [...settings.timePresets, { value: tempPreset, tagId: presetTab }] });
          setAddPreset(null);
        }}
      />
      <DurationPickerPopup
        visible={addPreset === 'dur'}
        value={tempPreset}
        presets={[]}
        onChange={setTempPreset}
        onClose={() => {
          const exists = settings.durationPresets.some((p) => p.value === tempPreset && (p.tagId ?? null) === presetTab);
          if (!exists) updateSettings({ durationPresets: [...settings.durationPresets, { value: tempPreset, tagId: presetTab }] });
          setAddPreset(null);
        }}
      />

      <PlaceEditorPopup
        visible={placeEdit != null}
        place={settings.places.find((p) => p.id === placeEdit) || null}
        tags={settings.tags}
        onRename={(name) => placeEdit && renamePlace(placeEdit, name)}
        onSetTag={(tagId) => placeEdit && setPlaceTag(placeEdit, tagId)}
        onSetLocation={(loc) => placeEdit && setPlaceLocation(placeEdit, loc)}
        onSetPhoto={(uri) => placeEdit && setPlacePhoto(placeEdit, uri)}
        onDelete={() => {
          if (placeEdit) deletePlace(placeEdit);
          setPlaceEdit(null);
        }}
        onClose={() => setPlaceEdit(null)}
      />

      {/* Edit one palette slot (a colour picked that's already in another slot swaps the two) */}
      <CenterPopup open={slotEdit?.kind === 'color'} onClose={() => setSlotEdit(null)}>
        <Text style={styles.colorTitle}>Palette color {slotEdit ? slotEdit.index + 1 : ''}</Text>
        <CustomColorGrid value={tempColor} onPick={setTempColor} />
        <View style={styles.popBtns}>
          <Pressable style={styles.popCancel} onPress={() => setSlotEdit(null)}>
            <Text style={styles.popCancelTxt}>Cancel</Text>
          </Pressable>
          <Pressable
            style={styles.popSave}
            onPress={() => {
              if (slotEdit) updateSettings({ colors: replaceSlot(settings.colors, slotEdit.index, tempColor) });
              setSlotEdit(null);
            }}>
            <Text style={styles.popSaveTxt}>Save</Text>
          </Pressable>
        </View>
      </CenterPopup>

      <CenterPopup open={slotEdit?.kind === 'icon'} onClose={() => setSlotEdit(null)}>
        <Text style={styles.colorTitle}>Icon {slotEdit ? slotEdit.index + 1 : ''}</Text>
        <CustomIconInput value={tempIcon} onChange={setTempIcon} />
        <Text style={styles.hint}>Type or paste any emoji, or up to two letters.</Text>
        <View style={styles.popBtns}>
          <Pressable style={styles.popCancel} onPress={() => setSlotEdit(null)}>
            <Text style={styles.popCancelTxt}>Cancel</Text>
          </Pressable>
          <Pressable
            disabled={!tempIcon.trim()}
            style={[styles.popSave, !tempIcon.trim() && { opacity: 0.4 }]}
            onPress={() => {
              const v = tempIcon.trim();
              if (slotEdit && v) updateSettings({ emojis: replaceSlot(settings.emojis, slotEdit.index, v) });
              setSlotEdit(null);
            }}>
            <Text style={styles.popSaveTxt}>Save</Text>
          </Pressable>
        </View>
      </CenterPopup>

      {/* Sub-tag icon: the icon set (+ custom), or none */}
      <CenterPopup open={subIconFor != null} onClose={() => setSubIconFor(null)}>
        {(() => {
          const st = settings.tags.find((t) => t.id === subIconFor);
          if (!st) return null;
          const parent = settings.tags.find((t) => t.id === st.parentId);
          return subIconPage === 'grid' ? (
            <Appear key="grid" from="left" distance={14}>
              <View style={styles.subIconHead}>
                <View style={[styles.subIconBig, { boxShadow: `inset 0 0 0 1.5px ${hexA(parent?.color ?? C.accentB, 0.6)}` }]}>
                  {st.icon ? <Text style={styles.subIconBigTxt}>{st.icon}</Text> : <Feather name="tag" size={18} color={parent?.color ?? C.accentB} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.colorTitle, { marginBottom: 2 }]}>{st.name}</Text>
                  <Text style={styles.subIconSub}>Sub-tag of {parent?.name ?? '—'}</Text>
                </View>
              </View>
              <IconGrid
                icons={settings.emojis}
                value={st.icon ?? ''}
                onPick={(e) => {
                  setTagIcon(st.id, e);
                  setTimeout(() => setSubIconFor(null), 240);
                }}
                onCustom={() => {
                  setTempIcon(st.icon ?? '');
                  setSubIconPage('custom');
                }}
              />
              <View style={styles.popBtns}>
                <Pressable style={styles.popCancel} onPress={() => { setTagIcon(st.id, null); setSubIconFor(null); }}>
                  <Text style={[styles.popCancelTxt, { color: st.icon ? C.danger : C.muted }]}>No icon</Text>
                </Pressable>
                <Pressable style={styles.popCancel} onPress={() => setSubIconFor(null)}>
                  <Text style={styles.popCancelTxt}>Done</Text>
                </Pressable>
              </View>
            </Appear>
          ) : (
            <Appear key="custom" from="right" distance={14}>
              <View style={styles.popHead}>
                <Pressable hitSlop={8} style={styles.popBack} onPress={() => setSubIconPage('grid')}>
                  <Feather name="chevron-left" size={20} color={C.textDim} />
                </Pressable>
                <Text style={[styles.colorTitle, { marginBottom: 0 }]}>Custom icon</Text>
              </View>
              <CustomIconInput value={tempIcon} onChange={setTempIcon} />
              <Text style={styles.hint}>Type or paste any emoji, or up to two letters.</Text>
              <View style={styles.popBtns}>
                <Pressable style={styles.popCancel} onPress={() => setSubIconPage('grid')}>
                  <Text style={styles.popCancelTxt}>Back</Text>
                </Pressable>
                <Pressable
                  disabled={!tempIcon.trim()}
                  style={[styles.popSave, !tempIcon.trim() && { opacity: 0.4 }]}
                  onPress={() => {
                    setTagIcon(st.id, tempIcon.trim());
                    setSubIconFor(null);
                  }}>
                  <Text style={styles.popSaveTxt}>Save</Text>
                </Pressable>
              </View>
            </Appear>
          );
        })()}
      </CenterPopup>

      {/* Tag colour: the palette row (+ custom), same as a task's picker */}
      <CenterPopup open={colorPick != null} onClose={() => setColorPick(null)}>
        {tagColorPage === 'main' ? (
          <Appear key="main" from="left" distance={14}>
            <Text style={styles.colorTitle}>Tag color</Text>
            <PaletteRow
              colors={settings.colors}
              value={pickedTag?.color ?? COLORS[0]}
              onPick={(c) => {
                if (colorPick) setTagColor(colorPick, c);
                setTimeout(() => setColorPick(null), 240); // let the ring land first
              }}
              onCustom={() => setTagColorPage('custom')}
            />
            <Pressable style={styles.popDone} onPress={() => setColorPick(null)}>
              <Text style={styles.popCancelTxt}>Done</Text>
            </Pressable>
          </Appear>
        ) : (
          <Appear key="custom" from="right" distance={14}>
            <View style={styles.popHead}>
              <Pressable hitSlop={8} style={styles.popBack} onPress={() => setTagColorPage('main')}>
                <Feather name="chevron-left" size={20} color={C.textDim} />
              </Pressable>
              <Text style={[styles.colorTitle, { marginBottom: 0 }]}>Custom color</Text>
            </View>
            <CustomColorGrid value={pickedTag?.color ?? COLORS[0]} onPick={(c) => colorPick && setTagColor(colorPick, c)} />
            <Pressable style={styles.popDone} onPress={() => setColorPick(null)}>
              <Text style={styles.popCancelTxt}>Done</Text>
            </Pressable>
          </Appear>
        )}
      </CenterPopup>
    </View>
  );
}

// "Half speed" / "75% speed" / "Normal speed" / "2× faster"
function speedCaption(v: number): string {
  if (v === 1) return 'Normal speed';
  if (v === 0.5) return 'Half speed';
  if (v < 1) return `${Math.round(v * 100)}% speed`;
  return `${fmtScale(v)} faster`;
}

// Put `v` into slot `index`; if it already sits in another slot, the two swap
// (so the palette / icon set never holds duplicates).
function replaceSlot(list: string[], index: number, v: string): string[] {
  const old = list[index];
  const dup = list.findIndex((x, i) => i !== index && x.toLowerCase() === v.toLowerCase());
  return list.map((x, i) => (i === index ? v : i === dup ? old : x));
}

// The last cell of a slot grid: restores the defaults.
function ResetTile({ size, round, delay, onPress }: { size: number; round?: boolean; delay: number; onPress: () => void }) {
  return (
    <Appear delay={delay}>
      <Tappable onPress={onPress} scaleTo={0.86} style={[styles.resetTile, { width: size, height: size, borderRadius: round ? size / 2 : Math.round(size * 0.3) }]}>
        <Feather name="rotate-ccw" size={Math.round(size * 0.38)} color={C.muted} />
      </Tappable>
    </Appear>
  );
}

// Eye toggle: are this tag's tasks shown as dots in the week strip?
function DotsToggle({ hidden, onPress }: { hidden: boolean; onPress: () => void }) {
  const v = useSharedValue(hidden ? 1 : 0);
  const pop = useSharedValue(1);
  useEffect(() => {
    v.value = withSpring(hidden ? 1 : 0, sp({ damping: 16, stiffness: 240 }));
    pop.value = 0.8;
    pop.value = withSpring(1, sp({ damping: 10, stiffness: 320 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden]);
  const bg = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(v.value, [0, 1], ['rgba(79,209,197,0.12)', 'rgba(255,255,255,0.04)']) }));
  const icon = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  return (
    <Tappable hitSlop={6} onPress={onPress}>
      <Animated.View style={[styles.eyeBtn, bg]}>
        <Animated.View style={icon}>
          <Feather name={hidden ? 'eye-off' : 'eye'} size={16} color={hidden ? C.faint : C.accentB} />
        </Animated.View>
      </Animated.View>
    </Tappable>
  );
}

function StepCard({ label, value, onDown, onUp }: { label: string; value: string; onDown: () => void; onUp: () => void }) {
  return (
    <View style={styles.stepCard}>
      <Text style={styles.stepLabel}>{label}</Text>
      <View style={styles.stepCtrl}>
        <Pressable onPress={onDown} style={styles.stepBtn} hitSlop={6}>
          <Text style={styles.stepBtnTxt}>−</Text>
        </Pressable>
        <Text style={styles.stepVal}>{value}</Text>
        <Pressable onPress={onUp} style={styles.stepBtn} hitSlop={6}>
          <Text style={styles.stepBtnTxt}>＋</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700', color: C.text },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 15, marginBottom: 10 },
  catIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(79,209,197,0.12)', alignItems: 'center', justifyContent: 'center' },
  catLabel: { fontSize: 16, fontWeight: '700', color: C.text },
  catSub: { fontSize: 12.5, color: C.muted, marginTop: 2 },
  catLive: { width: 7, height: 7, borderRadius: 4, marginRight: -4 },
  section: { fontSize: 11, color: C.muted, fontWeight: '700', marginBottom: 9, marginTop: 16, letterSpacing: 0.3 },
  hint: { fontSize: 12, color: C.muted, lineHeight: 17, marginTop: 10 },
  stepRow: { flexDirection: 'row', gap: 10 },
  stepCard: { flex: 1, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, paddingVertical: 11, paddingHorizontal: 14 },
  stepLabel: { fontSize: 11, color: C.muted, fontWeight: '600', marginBottom: 4 },
  stepCtrl: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepBtn: { width: 26, height: 26, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.07)', alignItems: 'center', justifyContent: 'center' },
  stepBtnTxt: { fontSize: 15, color: C.textDim },
  stepVal: { flex: 1, textAlign: 'center', fontSize: 15, fontWeight: '600', color: C.text, fontVariant: ['tabular-nums'] },
  segment: { flexDirection: 'row', gap: 8 },
  segBtn: { flex: 1, height: 46, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
  segBtnOn: { backgroundColor: C.accentB },
  segTxt: { fontSize: 14, fontWeight: '600' },
  manageBlock: { marginBottom: 8 },
  manageRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tagSwatch: { width: 34, height: 34, borderRadius: 10 },
  manageName: { flex: 1, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14 },
  colorTitle: { fontSize: 16, fontWeight: '700', color: C.text, marginBottom: 16 },
  placeName: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  manageNameTxt: { fontSize: 15, fontWeight: '600', color: C.text },
  smallBtn: { paddingHorizontal: 12, paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)' },
  smallBtnTxt: { fontSize: 13, fontWeight: '600', color: C.accentB },
  iconBtn: { width: 46, height: 46, borderRadius: 12, backgroundColor: 'rgba(248,103,122,0.12)', alignItems: 'center', justifyContent: 'center' },
  subWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 7, paddingLeft: 10 },
  subChip: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 9, paddingHorizontal: 11, paddingVertical: 8 },
  subChipTxt: { fontSize: 12.5, fontWeight: '600', color: C.textDim },
  subIcon: { width: 22, height: 22, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.07)' },
  subIconEmpty: { backgroundColor: 'rgba(255,255,255,0.02)' },
  subIconTxt: { fontSize: 12 },
  subIconHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  subIconBig: { width: 46, height: 46, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  subIconBigTxt: { fontSize: 22 },
  subIconSub: { fontSize: 12.5, color: C.muted, fontWeight: '600' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 14 },
  toggleIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(79,209,197,0.12)', alignItems: 'center', justifyContent: 'center' },
  toggleTitle: { fontSize: 15.5, fontWeight: '700', color: C.text },
  toggleSub: { fontSize: 12.5, color: C.muted, marginTop: 2 },
  scaleCard: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 16, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 6 },
  scaleHead: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  scaleVal: { fontSize: 28, fontWeight: '800', color: C.text, fontVariant: ['tabular-nums'] },
  scaleCap: { fontSize: 13, fontWeight: '600', color: C.muted },
  scaleReset: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, height: 30, borderRadius: 10, backgroundColor: 'rgba(79,209,197,0.12)' },
  scaleResetTxt: { fontSize: 12.5, fontWeight: '800', color: C.accentB },
  addBtn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', backgroundColor: 'rgba(124,124,240,0.12)', boxShadow: 'inset 0 0 0 1px rgba(124,124,240,0.28)', marginTop: 4 },
  addBtnTxt: { fontSize: 14, fontWeight: '700', color: C.accentA },
  tabBar: { gap: 8, paddingRight: 20, paddingBottom: 14 },
  tab: { paddingHorizontal: 15, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: C.accentB },
  tabTxt: { fontSize: 13.5, fontWeight: '700' },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 8 },
  placeThumb: { width: 42, height: 42, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.06)' },
  placeThumbEmpty: { width: 42, height: 42, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  placeMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  placeMeta: { fontSize: 12, color: C.muted, flex: 1 },
  emptyHint: { color: C.faint, fontSize: 13, paddingVertical: 14, textAlign: 'center' },
  presetNote: { color: C.muted, fontSize: 12, lineHeight: 17, marginTop: 16 },
  slotCard: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 16, paddingVertical: 12, paddingHorizontal: 6, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.05)' },
  resetTile: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.14)' },
  eyeBtn: { width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  nameHidden: { color: C.muted },
  legend: { flexDirection: 'row', gap: 8, marginTop: 16, paddingHorizontal: 4 },
  legendTxt: { flex: 1, fontSize: 12, color: C.muted, lineHeight: 17 },
  popBtns: { flexDirection: 'row', gap: 10, marginTop: 18 },
  popCancel: { flex: 1, height: 48, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.07)', alignItems: 'center', justifyContent: 'center' },
  popCancelTxt: { fontSize: 15, fontWeight: '700', color: C.text },
  popSave: { flex: 1, height: 48, borderRadius: 14, backgroundColor: C.accentB, alignItems: 'center', justifyContent: 'center' },
  popSaveTxt: { fontSize: 15, fontWeight: '700', color: '#0b0b0d' },
  popDone: { height: 48, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  popHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14, marginLeft: -6 },
  popBack: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  presetWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  presetChip: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  presetTxt: { fontSize: 13, fontWeight: '600', color: C.textDim, fontVariant: ['tabular-nums'] },
  presetAdd: { width: 40, height: 38, borderRadius: 10, backgroundColor: 'rgba(124,124,240,0.12)', alignItems: 'center', justifyContent: 'center' },
  rowBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 16, marginBottom: 8 },
  rowBtnTxt: { fontSize: 15, fontWeight: '600', color: C.text },
  rowSub: { fontSize: 12, color: C.muted, marginTop: 3, fontVariant: ['tabular-nums'] },
  about: { textAlign: 'center', color: C.faint, fontSize: 12, marginTop: 20 },
});
