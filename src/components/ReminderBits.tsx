import React, { useCallback, useEffect, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import * as Native from '../../modules/reminders';
import type { ReminderStatus, SettingsTarget } from '../../modules/reminders';
import { C } from '../theme';
import { motion, ms, sp } from '../motion';
import { ReminderIntensity } from '../types';
import { hexA } from '../utils';
import { Appear, Tappable } from './anim';

type Icon = keyof typeof Feather.glyphMap;

export const INTENSITIES: ReminderIntensity[] = ['easy', 'medium', 'intense'];

export const INTENSITY: Record<ReminderIntensity, { label: string; icon: Icon; color: string; title: string; blurb: string; features: string[] }> = {
  easy: {
    label: 'Easy',
    icon: 'bell',
    color: C.accentB,
    title: 'A notification',
    blurb: 'A banner with sound, like any other app.',
    features: ['Notification'],
  },
  medium: {
    label: 'Medium',
    icon: 'smartphone',
    color: C.accentA,
    title: 'Takes over the screen',
    blurb: 'The reminder opens over any app — even the lock screen — with one short buzz.',
    features: ['Full screen', 'One buzz', 'Notification'],
  },
  intense: {
    label: 'Intense',
    icon: 'volume-2',
    color: C.band,
    title: 'Rings like an alarm',
    blurb: 'Full screen, the alarm sound and pulsing vibration until you dismiss it.',
    features: ['Full screen', 'Alarm sound', 'Pulsing vibration', 'Until dismissed'],
  },
};

// ---------------------------------------------------------------------------
// Intensity picker — a segmented control with a sliding highlight, and a
// preview card whose little phone acts the intensity out.
// ---------------------------------------------------------------------------
export function IntensityPicker({ value, onChange, preview = true }: { value: ReminderIntensity; onChange: (v: ReminderIntensity) => void; preview?: boolean }) {
  const [w, setW] = useState(0);
  const idx = INTENSITIES.indexOf(value);
  const x = useSharedValue(idx);
  useEffect(() => {
    x.value = withSpring(idx, sp({ damping: 19, stiffness: 260, mass: 0.8 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);
  const segW = w > 0 ? (w - 8) / 3 : 0;
  const hl = useAnimatedStyle(() => ({
    width: segW,
    transform: [{ translateX: x.value * segW }],
    backgroundColor: interpolateColor(x.value, [0, 1, 2], [C.accentB, C.accentA, C.band]),
  }));
  const m = INTENSITY[value];
  return (
    <>
      <View style={styles.seg} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        {w > 0 && <Animated.View style={[styles.segHl, hl]} />}
        {INTENSITIES.map((k) => {
          const on = k === value;
          return (
            <Tappable key={k} onPress={() => onChange(k)} style={styles.segBtn} scaleTo={0.94}>
              <Feather name={INTENSITY[k].icon} size={14} color={on ? '#0b0b0d' : C.muted} />
              <Text style={[styles.segTxt, { color: on ? '#0b0b0d' : C.textDim }]}>{INTENSITY[k].label}</Text>
            </Tappable>
          );
        })}
      </View>
      {preview && (
        <View style={styles.pvCard}>
          <PhoneMock intensity={value} />
          <Appear key={value} from="right" distance={10} style={styles.pvText}>
            <Text style={[styles.pvTitle, { color: m.color }]}>{m.title}</Text>
            <Text style={styles.pvBlurb}>{m.blurb}</Text>
            <View style={styles.feats}>
              {m.features.map((f) => (
                <View key={f} style={[styles.feat, { backgroundColor: hexA(m.color, 0.12) }]}>
                  <Feather name="check" size={10} color={m.color} />
                  <Text style={[styles.featTxt, { color: m.color }]}>{f}</Text>
                </View>
              ))}
            </View>
          </Appear>
        </View>
      )}
    </>
  );
}

// A tiny phone acting the intensity out: a banner drops in (easy); the screen
// lights up with one buzz (medium); it rings — shaking, with sound waves (intense).
function PhoneMock({ intensity }: { intensity: ReminderIntensity }) {
  const p = useSharedValue(0);
  const on = motion.enabled;
  useEffect(() => {
    cancelAnimation(p);
    if (!on) {
      p.value = intensity === 'easy' ? 0.4 : 0.5;
      return;
    }
    p.value = 0;
    p.value = withRepeat(withTiming(1, { duration: ms(intensity === 'intense' ? 1600 : 2800), easing: Easing.linear }), -1, false);
    return () => cancelAnimation(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intensity, on]);

  const color = INTENSITY[intensity].color;
  const body = useAnimatedStyle(() => {
    let rot = 0;
    if (intensity === 'medium') rot = interpolate(p.value, [0, 0.03, 0.06, 0.09, 0.12, 0.15, 1], [0, -7, 7, -5, 5, 0, 0], Extrapolation.CLAMP);
    if (intensity === 'intense') rot = interpolate(p.value % 0.25, [0, 0.0625, 0.125, 0.1875, 0.25], [0, -5, 0, 5, 0]);
    return { transform: [{ rotate: `${rot}deg` }] };
  });
  const banner = useAnimatedStyle(() => ({
    opacity: intensity === 'easy' ? 1 : 0,
    transform: [{ translateY: interpolate(p.value, [0, 0.14, 0.7, 0.84, 1], [-30, 7, 7, -30, -30], Extrapolation.CLAMP) }],
  }));
  const screen = useAnimatedStyle(() => ({
    opacity: intensity === 'easy' ? 0 : intensity === 'medium' ? interpolate(p.value, [0, 0.06, 0.78, 0.92, 1], [0, 1, 1, 0, 0], Extrapolation.CLAMP) : 1,
  }));
  const ring = useAnimatedStyle(() => ({
    opacity: interpolate(p.value % 0.5, [0, 0.5], [0.8, 0], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(p.value % 0.5, [0, 0.5], [0.5, 1.5], Extrapolation.CLAMP) }],
  }));
  const waves = useAnimatedStyle(() => ({
    opacity: intensity === 'intense' ? interpolate(p.value % 0.5, [0, 0.25, 0.5], [0.25, 1, 0.25]) : 0,
  }));
  const buzz = useAnimatedStyle(() => ({
    opacity: intensity === 'medium' ? interpolate(p.value, [0, 0.02, 0.16, 0.22], [0, 1, 1, 0], Extrapolation.CLAMP) : 0,
  }));

  return (
    <View style={styles.mockWrap}>
      <Animated.View style={[styles.wave, styles.waveL, { borderColor: color }, waves]} />
      <Animated.View style={[styles.wave, styles.waveR, { borderColor: color }, waves]} />
      <Animated.View style={[styles.buzz, styles.buzzL, buzz]}>
        <View style={[styles.buzzLine, { backgroundColor: color }]} />
        <View style={[styles.buzzLine, { backgroundColor: color, width: 5 }]} />
      </Animated.View>
      <Animated.View style={[styles.buzz, styles.buzzR, buzz]}>
        <View style={[styles.buzzLine, { backgroundColor: color }]} />
        <View style={[styles.buzzLine, { backgroundColor: color, width: 5 }]} />
      </Animated.View>
      <Animated.View style={[styles.phone, body]}>
        <View style={styles.notch} />
        <Animated.View style={[styles.mockScreen, { backgroundColor: hexA(color, 0.9) }, screen]}>
          {intensity === 'intense' && <Animated.View style={[styles.mockRing, ring]} />}
          <View style={styles.mockTile} />
          <View style={styles.mockBar} />
          <View style={[styles.mockBar, { width: 16, opacity: 0.6 }]} />
        </Animated.View>
        <Animated.View style={[styles.mockBanner, { borderColor: hexA(color, 0.6) }, banner]}>
          <View style={[styles.mockDot, { backgroundColor: color }]} />
          <View style={styles.mockLine} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Reliability: what could stop a reminder from arriving, and the fix.
// ---------------------------------------------------------------------------

/** The native status, refreshed on mount and whenever the app comes back (e.g. from a settings screen). */
export function useReminderStatus(active = true) {
  const [status, setStatus] = useState<ReminderStatus | null>(null);
  const refresh = useCallback(() => {
    if (!Native.available) return;
    Native.getStatus().then((s) => s && setStatus(s));
  }, []);
  useEffect(() => {
    if (!active || !Native.available) return;
    refresh();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') refresh();
    });
    return () => sub.remove();
  }, [active, refresh]);
  return { status, refresh };
}

export type Check = {
  key: string;
  ok: boolean;
  icon: Icon;
  title: string; // when it needs fixing
  okTitle: string; // when it's fine
  sub: string;
  action: string;
  target: SettingsTarget | 'ask';
  level: 'block' | 'warn' | 'tip';
};

const BRANDS: Record<string, string> = { xiaomi: 'Xiaomi', redmi: 'Xiaomi', poco: 'Xiaomi', huawei: 'Huawei', honor: 'Honor', oppo: 'Oppo', realme: 'Realme', vivo: 'Vivo', oneplus: 'OnePlus', asus: 'Asus', samsung: 'Samsung', letv: 'LeEco' };

/** Every check that matters for `need` (screen = medium / intense, ring = intense). */
export function reminderChecks(s: ReminderStatus, need: { screen: boolean; ring: boolean }): Check[] {
  const out: Check[] = [
    { key: 'notifications', ok: s.notifications, icon: 'bell', title: 'Notifications are off', okTitle: 'Notifications allowed', sub: 'Operarius can’t show a single reminder until they’re allowed.', action: 'Allow', target: 'ask', level: 'block' },
    { key: 'restricted', ok: !s.restricted, icon: 'slash', title: 'Background use is restricted', okTitle: 'Runs in the background', sub: 'Android stops Operarius in the background, so nothing can ring. Set battery use to Unrestricted.', action: 'Fix', target: 'app', level: 'block' },
  ];
  if (need.screen) {
    out.push({ key: 'fullScreen', ok: s.fullScreen, icon: 'maximize', title: 'Full-screen alerts are off', okTitle: 'Can light up the lock screen', sub: 'The reminder screen can’t wake a locked phone without this.', action: 'Allow', target: 'fullScreen', level: 'block' });
    out.push({ key: 'overlay', ok: s.overlay, icon: 'layers', title: 'Can’t appear over other apps', okTitle: 'Appears over other apps', sub: 'Lets the reminder screen cover the app you’re using. Without it you get a banner instead.', action: 'Allow', target: 'overlay', level: 'warn' });
  }
  out.push({ key: 'exact', ok: s.exactAlarms, icon: 'clock', title: 'Exact alarms are off', okTitle: 'Rings on the minute', sub: 'Without “Alarms & reminders” access, reminders can arrive minutes late.', action: 'Allow', target: 'exact', level: 'warn' });
  out.push({ key: 'battery', ok: s.battery, icon: 'battery-charging', title: 'Battery optimization is on', okTitle: 'Not put to sleep by battery saving', sub: 'Android may hold back reminders to save power. Allow Operarius to run in the background.', action: 'Allow', target: 'battery', level: 'warn' });
  if (need.ring) {
    out.push({ key: 'volume', ok: s.alarmVolume > 0, icon: 'volume-2', title: 'Alarm volume is muted', okTitle: 'Alarm volume is up', sub: 'Intense reminders will only vibrate until you turn the alarm volume up.', action: 'Sound', target: 'sound', level: 'warn' });
  }
  if (s.autostart) {
    const brand = BRANDS[s.manufacturer] ?? 'phone';
    out.push({ key: 'autostart', ok: false, icon: 'power', title: 'Allow auto-start', okTitle: 'Auto-start', sub: `Your ${brand === 'phone' ? '' : brand + ' '}phone has its own switch that can stop reminders — make sure Operarius is allowed there.`, action: 'Open', target: 'autostart', level: 'tip' });
  }
  return out;
}

/** Runs a check's fix: asks for notifications first, else opens the right settings screen. */
export async function fixCheck(c: Check): Promise<void> {
  if (c.target === 'ask') {
    const ok = await Native.requestNotifications();
    if (!ok) await Native.openSettings('notifications');
    return;
  }
  await Native.openSettings(c.target);
}

const LEVEL_COLOR = { block: C.danger, warn: '#f5a15c', tip: C.accentA } as const;

/** The checks as a list: problems with their fix button (and, with `showOk`, the ones that are fine). */
export function CheckList({ checks, showOk = false, onFixed }: { checks: Check[]; showOk?: boolean; onFixed?: () => void }) {
  const rows = showOk ? checks : checks.filter((c) => !c.ok && c.level !== 'tip');
  if (rows.length === 0) return null;
  return (
    <View style={styles.checks}>
      {rows.map((c, i) => {
        const tone = c.ok ? C.accentB : LEVEL_COLOR[c.level];
        return (
          <Appear key={c.key} from="up" delay={30 + i * 40} distance={8}>
            <View style={[styles.check, !c.ok && { backgroundColor: hexA(tone, 0.07), boxShadow: `inset 0 0 0 1px ${hexA(tone, 0.22)}` }]}>
              <View style={[styles.checkIcon, { backgroundColor: hexA(tone, 0.14) }]}>
                <Feather name={c.ok ? 'check' : c.icon} size={15} color={tone} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.checkTitle}>{c.ok ? c.okTitle : c.title}</Text>
                {!c.ok && <Text style={styles.checkSub}>{c.sub}</Text>}
              </View>
              {!c.ok && (
                <Tappable
                  onPress={async () => {
                    await fixCheck(c);
                    onFixed?.();
                  }}
                  style={[styles.fixBtn, { backgroundColor: tone }]}>
                  <Text style={styles.fixTxt}>{c.action}</Text>
                </Tappable>
              )}
            </View>
          </Appear>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // Segmented intensity control
  seg: { flexDirection: 'row', padding: 4, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.05)' },
  segHl: { position: 'absolute', left: 4, top: 4, bottom: 4, borderRadius: 11 },
  segBtn: { flex: 1, height: 40, borderRadius: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  segTxt: { fontSize: 13.5, fontWeight: '800' },

  // Preview card
  pvCard: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 10, padding: 14, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.035)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.05)' },
  pvText: { flex: 1 },
  pvTitle: { fontSize: 14.5, fontWeight: '800' },
  pvBlurb: { fontSize: 12.5, color: C.textDim, lineHeight: 17, marginTop: 3 },
  feats: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 8 },
  feat: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7 },
  featTxt: { fontSize: 10.5, fontWeight: '800' },

  // Phone mock
  mockWrap: { width: 74, height: 96, alignItems: 'center', justifyContent: 'center' },
  phone: { width: 50, height: 88, borderRadius: 12, backgroundColor: '#0f1013', boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.18)', overflow: 'hidden', alignItems: 'center' },
  notch: { position: 'absolute', top: 5, width: 12, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.22)', zIndex: 3 },
  mockScreen: { position: 'absolute', top: 2, left: 2, right: 2, bottom: 2, borderRadius: 10, alignItems: 'center', justifyContent: 'center', gap: 4 },
  mockRing: { position: 'absolute', width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.8)' },
  mockTile: { width: 16, height: 16, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.92)' },
  mockBar: { width: 24, height: 3, borderRadius: 2, backgroundColor: 'rgba(11,11,13,0.55)' },
  mockBanner: { position: 'absolute', top: 0, left: 4, right: 4, height: 15, borderRadius: 5, backgroundColor: '#1d1e22', borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4 },
  mockDot: { width: 6, height: 6, borderRadius: 3 },
  mockLine: { flex: 1, height: 2.5, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)' },
  wave: { position: 'absolute', top: 30, width: 20, height: 36, borderRadius: 18, borderWidth: 2 },
  waveL: { left: -2, borderRightColor: 'transparent', borderTopColor: 'transparent', borderBottomColor: 'transparent' },
  waveR: { right: -2, borderLeftColor: 'transparent', borderTopColor: 'transparent', borderBottomColor: 'transparent' },
  buzz: { position: 'absolute', top: 38, gap: 4 },
  buzzL: { left: 2, alignItems: 'flex-end' },
  buzzR: { right: 2, alignItems: 'flex-start' },
  buzzLine: { width: 8, height: 2, borderRadius: 1 },

  // Checks
  checks: { gap: 8 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 11, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.04)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0)' },
  checkIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  checkTitle: { fontSize: 14, fontWeight: '700', color: C.text },
  checkSub: { fontSize: 12, color: C.muted, lineHeight: 16, marginTop: 2 },
  fixBtn: { paddingHorizontal: 12, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  fixTxt: { fontSize: 12.5, fontWeight: '800', color: '#0b0b0d' },
});
