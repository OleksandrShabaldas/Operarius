import React, { useEffect } from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { C } from '../theme';
import { sp } from '../motion';
import { hexA } from '../utils';
import { Appear, Tappable } from './anim';

// Building blocks shared by the single-choice pickers (tag, place): a header
// with the task it's for, section labels, rows whose selection glides in, and
// an empty state.

export function PickHead({ title, color, context }: { title: string; color: string; context: string }) {
  return (
    <>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.ctx}>
        <View style={[styles.ctxDot, { backgroundColor: color }]} />
        <Text style={styles.ctxTxt} numberOfLines={1}>
          {context}
        </Text>
      </View>
    </>
  );
}

export function PickSection({ text, icon, dot, delay = 0 }: { text: string; icon?: keyof typeof Feather.glyphMap; dot?: string; delay?: number }) {
  return (
    <Appear from="up" delay={delay} distance={6} style={styles.section}>
      {dot ? <View style={[styles.sectionDot, { backgroundColor: dot }]} /> : icon ? <Feather name={icon} size={12} color={C.muted} /> : null}
      <Text style={styles.sectionTxt}>{text}</Text>
      <View style={styles.sectionLine} />
    </Appear>
  );
}

// A choice row. Selected: tinted in `tint`, a ring, and a check badge — all
// springing in (and out when the choice moves elsewhere).
export function PickRow({
  on,
  tint,
  onPress,
  left,
  title,
  sub,
  right,
  style,
}: {
  on: boolean;
  tint: string;
  onPress: () => void;
  left?: React.ReactNode;
  title: string;
  sub?: string | null;
  right?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const p = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    p.value = withSpring(on ? 1 : 0, sp({ damping: 19, stiffness: 260 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);
  const from = hexA(tint, 0);
  const to = hexA(tint, 0.13);
  const tintStyle = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(p.value, [0, 1], [from, to]) }));
  const ringStyle = useAnimatedStyle(() => ({ opacity: p.value }));
  const badgeStyle = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ scale: 0.3 + 0.7 * p.value }] }));
  return (
    <Tappable onPress={onPress} scaleTo={0.97} style={style}>
      <Animated.View style={[styles.row, tintStyle]}>
        <Animated.View pointerEvents="none" style={[styles.ring, { borderColor: hexA(tint, 0.42) }, ringStyle]} />
        {left}
        <View style={styles.rowBody}>
          <Text style={[styles.rowTitle, on && { color: C.text }]} numberOfLines={1}>
            {title}
          </Text>
          {!!sub && (
            <Text style={styles.rowSub} numberOfLines={1}>
              {sub}
            </Text>
          )}
        </View>
        {right}
        <View style={styles.badgeSlot}>
          <Animated.View style={[styles.badge, { backgroundColor: tint }, badgeStyle]}>
            <Feather name="check" size={12} color="#0b0b0d" />
          </Animated.View>
        </View>
      </Animated.View>
    </Tappable>
  );
}

// "No tag" / "No place".
export function NoneRow({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  return (
    <PickRow
      on={on}
      tint={C.accentB}
      onPress={onPress}
      title={label}
      left={
        <View style={styles.noneIcon}>
          <Feather name="slash" size={14} color={on ? C.accentB : C.muted} />
        </View>
      }
    />
  );
}

export function PickEmpty({ icon, title, text }: { icon: keyof typeof Feather.glyphMap; title: string; text: string }) {
  return (
    <Appear from="up" delay={60} style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Feather name={icon} size={22} color={C.muted} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyTxt}>{text}</Text>
    </Appear>
  );
}

// Where to change the list, and Done.
export function PickFooter({ hint, onDone }: { hint: string; onDone: () => void }) {
  return (
    <View style={styles.footer}>
      <View style={styles.hint}>
        <Feather name="settings" size={12} color={C.faint} />
        <Text style={styles.hintTxt}>{hint}</Text>
      </View>
      <Tappable onPress={onDone} style={styles.done}>
        <Text style={styles.doneTxt}>Done</Text>
      </Tappable>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 19, fontWeight: '700', color: C.text },
  ctx: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, marginBottom: 14 },
  ctxDot: { width: 8, height: 8, borderRadius: 4 },
  ctxTxt: { flex: 1, fontSize: 13, fontWeight: '600', color: C.muted },
  section: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 16, marginBottom: 8 },
  sectionDot: { width: 7, height: 7, borderRadius: 4 },
  sectionTxt: { fontSize: 11, color: C.muted, fontWeight: '800', letterSpacing: 0.6 },
  sectionLine: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.07)', marginLeft: 3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, paddingHorizontal: 10, borderRadius: 14, minHeight: 52 },
  ring: { ...StyleSheet.absoluteFill, borderRadius: 14, borderWidth: 1 },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 15, fontWeight: '700', color: C.textDim },
  rowSub: { fontSize: 12, fontWeight: '600', color: C.muted, marginTop: 2 },
  badgeSlot: { width: 22, height: 22 },
  badge: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  noneIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.18)' },
  empty: { alignItems: 'center', paddingVertical: 22, paddingHorizontal: 20, gap: 6 },
  emptyIcon: { width: 52, height: 52, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: C.textDim },
  emptyTxt: { fontSize: 13, color: C.muted, textAlign: 'center', lineHeight: 18 },
  footer: { marginTop: 16, gap: 12 },
  hint: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  hintTxt: { fontSize: 12, fontWeight: '600', color: C.faint },
  done: { height: 50, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  doneTxt: { fontSize: 15, fontWeight: '700', color: C.text },
});
