import { makeMutable } from 'react-native-reanimated';

// ---------------------------------------------------------------------------
// App-wide motion settings (Settings → Animations).
//
// `scale` works like Android's "animation duration scale": every duration and
// delay is multiplied by it (0.5× = twice as fast, 4× = four times slower) and
// springs are re-tuned to run at the same rate with the same bounce. Turning
// animations off is handled globally by <ReducedMotionConfig> in App, which
// makes every Reanimated animation (incl. layout animations) finish instantly.
//
// Animations are built on the JS thread from `motion`; the few that start
// inside worklets (gesture callbacks) read the UI-thread copy `MOTION_SCALE`.
// ---------------------------------------------------------------------------

export const MIN_SCALE = 0.5;
export const MAX_SCALE = 4;

export const motion = { enabled: true, scale: 1 };
export const MOTION_SCALE = makeMutable(1);

export function setMotion(enabled: boolean, scale: number) {
  const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale || 1));
  motion.enabled = enabled;
  motion.scale = s;
  MOTION_SCALE.value = s;
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
