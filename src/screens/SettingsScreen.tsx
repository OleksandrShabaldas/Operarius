import React, { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { C } from '../theme';
import { Tag } from '../types';
import { useApp } from '../store';
import { fmt, fmtDur } from '../utils';
import { TextPromptModal } from '../components/TextPromptModal';
import { PlaceIcon } from '../components/PlaceIcon';
import { TimePickerPopup, DurationPickerPopup } from '../components/pickers';
import { Tappable } from '../components/anim';

const Pressable = Tappable; // every tappable control gets press feedback

type Category = 'general' | 'appearance' | 'tags' | 'places' | 'presets' | 'data' | 'about';
type Prompt = { title: string; initial: string; submitLabel: string; onSubmit: (t: string) => void };

const CATS: { id: Category; label: string; icon: keyof typeof Feather.glyphMap; sub: string }[] = [
  { id: 'general', label: 'General', icon: 'sliders', sub: 'Day window, week start, gaps' },
  { id: 'appearance', label: 'Appearance', icon: 'clock', sub: 'Time format' },
  { id: 'tags', label: 'Tags', icon: 'tag', sub: 'Tags and sub-tags' },
  { id: 'places', label: 'Places', icon: 'map-pin', sub: 'Saved places' },
  { id: 'presets', label: 'Presets', icon: 'zap', sub: 'Quick time & duration picks' },
  { id: 'data', label: 'Data', icon: 'database', sub: 'Clear tasks' },
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
  const { settings, updateSettings, clearCompleted, clearAll, addTag, renameTag, deleteTag, addPlace, renamePlace, deletePlace } = app;
  const [cat, setCat] = useState<Category | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [addPreset, setAddPreset] = useState<'time' | 'dur' | null>(null);
  const [tempPreset, setTempPreset] = useState(12 * 60);

  const confirm = (title: string, msg: string, action: () => void) =>
    Alert.alert(title, msg, [
      { text: 'Cancel', style: 'cancel' },
      { text: title, style: 'destructive', onPress: action },
    ]);

  const topTags = settings.tags.filter((t) => t.parentId == null);
  const subtagsOf = (id: string) => settings.tags.filter((t) => t.parentId === id);

  const title = cat ? CATS.find((c) => c.id === cat)!.label : 'Settings';

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
                  <Text style={styles.catSub}>{c.sub}</Text>
                </View>
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
          </View>
        )}

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
          </View>
        )}

        {cat === 'tags' && (
          <View style={{ marginTop: 10 }}>
            {topTags.map((tag: Tag) => (
              <View key={tag.id} style={styles.manageBlock}>
                <View style={styles.manageRow}>
                  <Pressable style={styles.manageName} onPress={() => setPrompt({ title: 'Rename tag', initial: tag.name, submitLabel: 'Save', onSubmit: (t) => renameTag(tag.id, t) })}>
                    <Text style={styles.manageNameTxt}>{tag.name}</Text>
                  </Pressable>
                  <Pressable hitSlop={6} style={styles.smallBtn} onPress={() => setPrompt({ title: `New sub-tag in "${tag.name}"`, initial: '', submitLabel: 'Add', onSubmit: (t) => addTag(t, tag.id) })}>
                    <Text style={styles.smallBtnTxt}>＋ sub</Text>
                  </Pressable>
                  <Pressable hitSlop={6} style={styles.iconBtn} onPress={() => confirm('Delete', `Delete "${tag.name}" and its sub-tags?`, () => deleteTag(tag.id))}>
                    <Feather name="trash-2" size={15} color={C.danger} />
                  </Pressable>
                </View>
                {subtagsOf(tag.id).length > 0 && (
                  <View style={styles.subWrap}>
                    {subtagsOf(tag.id).map((st) => (
                      <View key={st.id} style={styles.subChip}>
                        <Pressable onPress={() => setPrompt({ title: 'Rename sub-tag', initial: st.name, submitLabel: 'Save', onSubmit: (t) => renameTag(st.id, t) })}>
                          <Text style={styles.subChipTxt}>{st.name}</Text>
                        </Pressable>
                        <Pressable hitSlop={8} onPress={() => confirm('Delete', `Delete sub-tag "${st.name}"?`, () => deleteTag(st.id))}>
                          <Feather name="x" size={13} color={C.faint} />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            ))}
            <Pressable style={styles.addBtn} onPress={() => setPrompt({ title: 'New tag', initial: '', submitLabel: 'Add', onSubmit: (t) => addTag(t, null) })}>
              <Text style={styles.addBtnTxt}>＋ New tag</Text>
            </Pressable>
          </View>
        )}

        {cat === 'places' && (
          <View style={{ marginTop: 10 }}>
            {settings.places.map((pl) => (
              <View key={pl.id} style={styles.manageBlock}>
                <View style={styles.manageRow}>
                  <Pressable style={[styles.manageName, styles.placeName]} onPress={() => setPrompt({ title: 'Rename place', initial: pl.name, submitLabel: 'Save', onSubmit: (t) => renamePlace(pl.id, t) })}>
                    <PlaceIcon size={14} color={C.textDim} />
                    <Text style={styles.manageNameTxt}>{pl.name}</Text>
                  </Pressable>
                  <Pressable hitSlop={6} style={styles.iconBtn} onPress={() => confirm('Delete', `Delete place "${pl.name}"?`, () => deletePlace(pl.id))}>
                    <Feather name="trash-2" size={15} color={C.danger} />
                  </Pressable>
                </View>
              </View>
            ))}
            <Pressable style={styles.addBtn} onPress={() => setPrompt({ title: 'New place', initial: '', submitLabel: 'Add', onSubmit: (t) => addPlace(t) })}>
              <Text style={styles.addBtnTxt}>＋ New place</Text>
            </Pressable>
          </View>
        )}

        {cat === 'presets' && (
          <View style={{ marginTop: 10 }}>
            <Text style={styles.section}>TIME PRESETS</Text>
            <View style={styles.presetWrap}>
              {settings.timePresets.map((p) => (
                <View key={p} style={styles.presetChip}>
                  <Text style={styles.presetTxt}>{fmt(p, settings.clock)}</Text>
                  <Pressable hitSlop={8} onPress={() => updateSettings({ timePresets: settings.timePresets.filter((x) => x !== p) })}>
                    <Feather name="x" size={13} color={C.faint} />
                  </Pressable>
                </View>
              ))}
              <Pressable style={styles.presetAdd} onPress={() => { setTempPreset(12 * 60); setAddPreset('time'); }}>
                <Feather name="plus" size={14} color={C.accentA} />
              </Pressable>
            </View>
            <Text style={styles.section}>DURATION PRESETS</Text>
            <View style={styles.presetWrap}>
              {settings.durationPresets.map((p) => (
                <View key={p} style={styles.presetChip}>
                  <Text style={styles.presetTxt}>{fmtDur(p)}</Text>
                  <Pressable hitSlop={8} onPress={() => updateSettings({ durationPresets: settings.durationPresets.filter((x) => x !== p) })}>
                    <Feather name="x" size={13} color={C.faint} />
                  </Pressable>
                </View>
              ))}
              <Pressable style={styles.presetAdd} onPress={() => { setTempPreset(30); setAddPreset('dur'); }}>
                <Feather name="plus" size={14} color={C.accentA} />
              </Pressable>
            </View>
          </View>
        )}

        {cat === 'data' && (
          <View style={{ marginTop: 10 }}>
            <Pressable style={styles.rowBtn} onPress={() => confirm('Clear completed', 'Remove all completed tasks?', () => clearCompleted())}>
              <Text style={styles.rowBtnTxt}>Clear completed tasks</Text>
              <Feather name="chevron-right" size={20} color={C.muted} />
            </Pressable>
            <Pressable style={styles.rowBtn} onPress={() => confirm('Clear all', 'Delete every task? This cannot be undone.', clearAll)}>
              <Text style={[styles.rowBtnTxt, { color: C.danger }]}>Delete all tasks</Text>
              <Feather name="chevron-right" size={20} color={C.danger} />
            </Pressable>
          </View>
        )}

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
          if (!settings.timePresets.includes(tempPreset)) updateSettings({ timePresets: [...settings.timePresets, tempPreset].sort((a, b) => a - b) });
          setAddPreset(null);
        }}
      />
      <DurationPickerPopup
        visible={addPreset === 'dur'}
        value={tempPreset}
        presets={[]}
        onChange={setTempPreset}
        onClose={() => {
          if (!settings.durationPresets.includes(tempPreset)) updateSettings({ durationPresets: [...settings.durationPresets, tempPreset].sort((a, b) => a - b) });
          setAddPreset(null);
        }}
      />
    </View>
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
  section: { fontSize: 11, color: C.muted, fontWeight: '700', marginBottom: 9, marginTop: 16, letterSpacing: 0.3 },
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
  manageName: { flex: 1, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14 },
  placeName: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  manageNameTxt: { fontSize: 15, fontWeight: '600', color: C.text },
  smallBtn: { paddingHorizontal: 12, paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)' },
  smallBtnTxt: { fontSize: 13, fontWeight: '600', color: C.accentB },
  iconBtn: { width: 46, height: 46, borderRadius: 12, backgroundColor: 'rgba(248,103,122,0.12)', alignItems: 'center', justifyContent: 'center' },
  subWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 7, paddingLeft: 10 },
  subChip: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 9, paddingHorizontal: 11, paddingVertical: 8 },
  subChipTxt: { fontSize: 12.5, fontWeight: '600', color: C.textDim },
  addBtn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', backgroundColor: 'rgba(124,124,240,0.12)', boxShadow: 'inset 0 0 0 1px rgba(124,124,240,0.28)', marginTop: 4 },
  addBtnTxt: { fontSize: 14, fontWeight: '700', color: C.accentA },
  presetWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  presetChip: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  presetTxt: { fontSize: 13, fontWeight: '600', color: C.textDim, fontVariant: ['tabular-nums'] },
  presetAdd: { width: 40, height: 38, borderRadius: 10, backgroundColor: 'rgba(124,124,240,0.12)', alignItems: 'center', justifyContent: 'center' },
  rowBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 16, marginBottom: 8 },
  rowBtnTxt: { fontSize: 15, fontWeight: '600', color: C.text },
  rowSub: { fontSize: 12, color: C.muted, marginTop: 3, fontVariant: ['tabular-nums'] },
  about: { textAlign: 'center', color: C.faint, fontSize: 12, marginTop: 20 },
});
