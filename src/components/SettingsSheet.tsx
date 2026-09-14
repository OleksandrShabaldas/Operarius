import React from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { C } from '../theme';
import { Settings } from '../types';
import { fmt } from '../utils';

type Props = {
  visible: boolean;
  settings: Settings;
  currentVersion: string;
  checkingUpdates: boolean;
  onCheckUpdates: () => void;
  onPatch: (patch: Partial<Settings>) => void;
  onClearCompleted: () => void;
  onClearAll: () => void;
  onClose: () => void;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function SettingsSheet({
  visible,
  settings,
  currentVersion,
  checkingUpdates,
  onCheckUpdates,
  onPatch,
  onClearCompleted,
  onClearAll,
  onClose,
}: Props) {
  const confirm = (title: string, msg: string, action: () => void) =>
    Alert.alert(title, msg, [
      { text: 'Cancel', style: 'cancel' },
      { text: title, style: 'destructive', onPress: action },
    ]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <AnimatedPressable style={styles.backdrop} entering={FadeIn.duration(180)} onPress={onClose} />
        <Animated.View entering={SlideInDown.duration(280)} style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.heading}>Settings</Text>

          <Text style={styles.section}>DAY WINDOW</Text>
          <View style={styles.stepRow}>
            <StepCard
              label="START"
              value={fmt(settings.dayStart)}
              onDown={() => onPatch({ dayStart: Math.max(0, settings.dayStart - 30) })}
              onUp={() => onPatch({ dayStart: Math.min(settings.dayEnd - 60, settings.dayStart + 30) })}
            />
            <StepCard
              label="END"
              value={fmt(settings.dayEnd)}
              onDown={() => onPatch({ dayEnd: Math.max(settings.dayStart + 60, settings.dayEnd - 30) })}
              onUp={() => onPatch({ dayEnd: Math.min(24 * 60, settings.dayEnd + 30) })}
            />
          </View>

          <Text style={styles.section}>START WEEK ON</Text>
          <View style={styles.segment}>
            {(['mon', 'sun'] as const).map((w) => {
              const on = settings.weekStart === w;
              return (
                <Pressable
                  key={w}
                  onPress={() => onPatch({ weekStart: w })}
                  style={[styles.segBtn, on && styles.segBtnOn]}>
                  <Text style={[styles.segTxt, { color: on ? '#0b0b0d' : C.textDim }]}>
                    {w === 'mon' ? 'Monday' : 'Sunday'}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.section}>UPDATES</Text>
          <Pressable style={styles.rowBtn} onPress={onCheckUpdates} disabled={checkingUpdates}>
            <View>
              <Text style={styles.rowBtnTxt}>Check for updates</Text>
              <Text style={styles.rowSub}>Current version · v{currentVersion}</Text>
            </View>
            {checkingUpdates ? (
              <ActivityIndicator size="small" color={C.accentB} />
            ) : (
              <Text style={styles.chev}>›</Text>
            )}
          </Pressable>

          <Text style={styles.section}>DATA</Text>
          <Pressable
            style={styles.rowBtn}
            onPress={() =>
              confirm('Clear completed', 'Remove all completed tasks across every day?', onClearCompleted)
            }>
            <Text style={styles.rowBtnTxt}>Clear completed tasks</Text>
            <Text style={styles.chev}>›</Text>
          </Pressable>
          <Pressable
            style={styles.rowBtn}
            onPress={() =>
              confirm('Clear all', 'Delete every task? This cannot be undone.', onClearAll)
            }>
            <Text style={[styles.rowBtnTxt, { color: C.danger }]}>Delete all tasks</Text>
            <Text style={[styles.chev, { color: C.danger }]}>›</Text>
          </Pressable>

          <Text style={styles.about}>Operarius · v{currentVersion}</Text>

          <Pressable onPress={onClose} style={styles.done}>
            <Text style={styles.doneTxt}>Done</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

function StepCard({
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
  sheet: {
    backgroundColor: C.sheet,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 34,
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
  heading: { fontSize: 21, fontWeight: '700', color: C.text, marginBottom: 18 },
  section: { fontSize: 11, color: C.muted, fontWeight: '600', marginBottom: 9, marginTop: 6 },
  stepRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
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
  segment: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  segBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  segBtnOn: { backgroundColor: C.accentB },
  segTxt: { fontSize: 14, fontWeight: '600' },
  rowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 15,
    marginBottom: 8,
  },
  rowBtnTxt: { fontSize: 15, fontWeight: '600', color: C.text },
  rowSub: { fontSize: 12, color: C.muted, marginTop: 3, fontVariant: ['tabular-nums'] },
  chev: { fontSize: 20, color: C.muted },
  about: { textAlign: 'center', color: C.faint, fontSize: 12, marginTop: 14, marginBottom: 4 },
  done: { height: 52, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  doneTxt: { fontSize: 16, fontWeight: '700', color: C.text },
});
