import { makeMutable } from 'react-native-reanimated';

// ---------------------------------------------------------------------------
// App-wide motion settings (Settings → Animations).
//
// The user picks a *speed* (0.5× = half speed … 4× = four times faster). Inside,
// that becomes `scale`, the duration factor (1 / speed): every duration and
// delay is multiplied by it and springs are re-tuned to run at the same rate
// with the same bounce. Turning animations off is handled globally by
// <ReducedMotionConfig> in App, which makes every Reanimated animation (incl.
// layout animations) finish instantly.
//
// Animations are built on the JS thread from `motion`; the few that start
// inside worklets (gesture callbacks) read the UI-thread copy `MOTION_SCALE`.
// ---------------------------------------------------------------------------

export const MIN_SPEED = 0.5;
export const MAX_SPEED = 4;
/** The speeds the slider offers (evenly spaced on it). */
export const SPEED_STOPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4];

/** The stop nearest to `v` (used when migrating older duration-based values). */
export function nearestSpeed(v: number): number {
  let best = SPEED_STOPS[0];
  for (const s of SPEED_STOPS) if (Math.abs(s - v) < Math.abs(best - v)) best = s;
  return best;
}

export const motion = { enabled: true, scale: 1 };
export const MOTION_SCALE = makeMutable(1);

export function setMotion(enabled: boolean, speed: number) {
  const v = Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed || 1));
  motion.enabled = enabled;
  motion.scale = 1 / v;
  MOTION_SCALE.value = 1 / v;
}

/** A duration / delay in ms, scaled. 0 when animations are off. */
export function ms(v: number): number {
  return motion.enabled ? Math.round(v * motion.scale) : 0;
}

type SpringCfg = { damping?: number; stiffness?: number; mass?: number; overshootClamping?: boolean };

// Slowing a spring down by `s` without changing its character: the natural
// frequency drops by s (stiffness / s²) and damping follows (damping / s), so
// the damping ratio — the "bounciness" — stays the same.
function scaleSpring<T extends SpringCfg>(cfg: T, s: number): T {
  if (s === 1) return cfg;
  return { ...cfg, stiffness: (cfg.stiffness ?? 100) / (s * s), damping: (cfg.damping ?? 10) / s };
}

/** A withSpring config, scaled (JS thread). */
export function sp<T extends SpringCfg>(cfg: T): T {
  return scaleSpring(cfg, motion.scale);
}

/** A withSpring config, scaled — callable inside worklets. */
export function spW<T extends SpringCfg>(cfg: T): T {
  'worklet';
  const s = MOTION_SCALE.value;
  if (s === 1) return cfg;
  return { ...cfg, stiffness: (cfg.stiffness ?? 100) / (s * s), damping: (cfg.damping ?? 10) / s };
}

/** A duration in ms, scaled — callable inside worklets. */
export function msW(v: number): number {
  'worklet';
  return Math.round(v * MOTION_SCALE.value);
}
