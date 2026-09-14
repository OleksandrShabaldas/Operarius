import React from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, EMOJIS, TAGS, C } from '../theme';
import { Draft } from '../types';
import { fmt, fmtDur, hexA } from '../utils';

type Props = {
  draft: Draft | null;
  dayStart: number;
  dayEnd: number;
  onPatch: (patch: Partial<Draft>) => void;
  onSave: () => void;
  onDelete: () => void;
  onClose: () => void;
};

export function TaskEditorSheet({ draft, dayStart, dayEnd, onPatch, onSave, onDelete, onClose }: Props) {
  const visible = !!draft;
  const isEditing = !!(draft && draft.id);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      {draft && (
        <View style={styles.root}>
          <AnimatedPressable style={styles.backdrop} entering={FadeIn.duration(180)} onPress={onClose} />
          <Animated.View entering={SlideInDown.duration(280)} style={styles.sheetWrap}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
              <View style={styles.sheet}>
                <ScrollView
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  bounces={false}>
                  <View style={styles.handle} />

                  <View style={styles.titleRow}>
                    <LinearGradient
                      colors={[draft.color, hexA(draft.color, 0.75)]}
                      start={{ x: 0.1, y: 0 }}
                      end={{ x: 0.9, y: 1 }}
                      style={[styles.marker, { boxShadow: `0 6px 16px -4px ${hexA(draft.color, 0.7)}` }]}>
                      <Text style={styles.markerTxt}>{draft.emoji}</Text>
                    </LinearGradient>
                    <TextInput
                      value={draft.title}
                      onChangeText={(title) => onPatch({ title })}
                      placeholder="Task name"
                      placeholderTextColor={C.faint}
                      style={styles.titleInput}
                    />
                  </View>

                  <View style={styles.stepRow}>
                    <Stepper
                      label="START"
                      value={fmt(draft.start)}
                      onDown={() => onPatch({ start: Math.max(dayStart - 45, draft.start - 15) })}
                      onUp={() => onPatch({ start: Math.min(dayEnd - 15, draft.start + 15) })}
                    />
                    <Stepper
                      label="DURATION"
                      value={fmtDur(draft.dur)}
                      onDown={() => onPatch({ dur: Math.max(15, draft.dur - 15) })}
                      onUp={() => onPatch({ dur: draft.dur + 15 })}
                    />
                  </View>

                  <Text style={styles.section}>TAG</Text>
                  <View style={styles.wrapRow}>
                    {TAGS.map((lb) => {
                      const on = draft.tag === lb;
                      return (
                        <Pressable
                          key={lb}
                          onPress={() => onPatch({ tag: on ? '' : lb })}
                          style={[
                            styles.tag,
                            {
                              backgroundColor: on ? hexA(draft.color, 0.16) : 'rgba(255,255,255,0.05)',
                              boxShadow: on ? `inset 0 0 0 1.5px ${hexA(draft.color, 0.5)}` : undefined,
                            },
                          ]}>
                          <Text style={[styles.tagTxt, { color: on ? draft.color : C.textDim }]}>{lb}</Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Text style={styles.section}>COLOR</Text>
                  <View style={styles.wrapRow}>
                    {COLORS.map((c) => {
                      const on = draft.color === c;
                      return (
                        <Pressable
                          key={c}
                          onPress={() => onPatch({ color: c })}
                          style={[
                            styles.swatch,
                            { backgroundColor: c, boxShadow: on ? `0 0 0 3px ${C.sheet}, 0 0 0 5px ${c}` : undefined },
                          ]}
                        />
                      );
                    })}
                  </View>

                  <Text style={styles.section}>ICON</Text>
                  <View style={styles.wrapRow}>
                    {EMOJIS.map((ch) => {
                      const on = draft.emoji === ch;
                      return (
                        <Pressable
                          key={ch}
                          onPress={() => onPatch({ emoji: ch })}
                          style={[
                            styles.emoji,
                            {
                              backgroundColor: on ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)',
                              boxShadow: on ? 'inset 0 0 0 1.5px rgba(255,255,255,0.4)' : undefined,
                            },
                          ]}>
                          <Text style={styles.emojiTxt}>{ch}</Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <View style={styles.actions}>
                    {isEditing && (
                      <Pressable onPress={onDelete} style={styles.delete}>
                        <Text style={styles.deleteTxt}>🗑</Text>
                      </Pressable>
                    )}
                    <Pressable onPress={onSave} style={styles.saveWrap}>
                      <LinearGradient
                        colors={[C.accentA, C.accentB]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={styles.save}>
                        <Text style={styles.saveTxt}>{isEditing ? 'Save changes' : 'Add task'}</Text>
                      </LinearGradient>
                    </Pressable>
                  </View>
                </ScrollView>
              </View>
            </KeyboardAvoidingView>
          </Animated.View>
        </View>
      )}
    </Modal>
  );
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function Stepper({
  label,
  value,
  onDown,
  onUp,
}: {
  label: string;
  value: string;
  onDown: () => void;
  onUp: () => void;
}) {
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
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheetWrap: { width: '100%' },
  sheet: {
    backgroundColor: C.sheet,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 30,
    maxHeight: '92%',
    boxShadow: '0 -20px 60px -20px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(255,255,255,0.06)',
  },
  handle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignSelf: 'center',
    marginBottom: 16,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  marker: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  markerTxt: { fontSize: 21 },
  titleInput: { flex: 1, color: C.text, fontSize: 21, fontWeight: '600', padding: 0 },
  stepRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  stepCard: { flex: 1, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, paddingVertical: 11, paddingHorizontal: 14 },
  stepLabel: { fontSize: 11, color: C.muted, fontWeight: '600', marginBottom: 4 },
  stepCtrl: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepBtn: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnTxt: { fontSize: 15, color: C.textDim },
  stepVal: { flex: 1, textAlign: 'center', fontSize: 15, fontWeight: '600', color: C.text, fontVariant: ['tabular-nums'] },
  section: { fontSize: 11, color: C.muted, fontWeight: '600', marginBottom: 9 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  tag: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 11 },
  tagTxt: { fontSize: 12.5, fontWeight: '600' },
  swatch: { width: 32, height: 32, borderRadius: 16, marginVertical: 2, marginHorizontal: 1 },
  emoji: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  emojiTxt: { fontSize: 18 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  delete: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: 'rgba(248,103,122,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteTxt: { fontSize: 19 },
  saveWrap: { flex: 1, borderRadius: 16, overflow: 'hidden', boxShadow: `0 8px 24px -8px ${hexA('#7c7cf0', 0.7)}` },
  save: { height: 52, alignItems: 'center', justifyContent: 'center' },
  saveTxt: { fontSize: 16, fontWeight: '700', color: '#0b0b0d' },
});
