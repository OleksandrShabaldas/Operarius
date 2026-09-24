import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  SharedValue,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, LinearGradient as SvgGrad, Stop } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { C, DOW, MONTHS, WEEKDAYS_FULL } from '../theme';
import { motion, ms, sp } from '../motion';
import { useApp } from '../store';
import { Clock, WeekStart } from '../types';
import { addDays, dateFromKey, fmt, hexA, todayKey, weekdayLetters } from '../utils';
import {
  dayStats,
  DayStat,
  firstDay,
  HeatCell,
  overToday,
  heatmap,
  hoursLabel,
  pctOf,
  Period,
  periodKeys,
  periodTitle,
  perfectStreak,
  plural,
  prevName,
  prevPoint,
  Rhythm,
  rhythm,
  Routine,
  routines,
  shiftPeriod,
  Streak,
  TagSlice,
  tagSlices,
  Totals,
  totals,
} from '../insights';
import { RollingText } from '../components/RollingText';
import { Appear, Tappable } from '../components/anim';

const FLAME: [string, string] = ['#F5A15C', '#F8677A'];
const GOLD = '#F2C14E';
const HEAT_WEEKS = 16;
const RHYTHM_DAYS = 84; // 12 weeks

export function StatsScreen({ onClose, onPickDay }: { onClose: () => void; onPickDay: (key: string) => void }) {
  const insets = useSafeAreaInsets();
  const { tasks, settings } = useApp();
  const today = todayKey();
  const ws = settings.weekStart;

  const [period, setPeriod] = useState<Period>('week');
  const [anchor, setAnchor] = useState(today);
  const [dir, setDir] = useState(1);

  const stat = useMemo(() => dayStats(tasks, today), [tasks, today]);
  const first = useMemo(() => firstDay(tasks), [tasks]);
  const now = new Date();
  const over = useMemo(() => overToday(tasks, today, now.getHours() * 60 + now.getMinutes()), [tasks, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const keys = periodKeys(period, anchor, ws);
  const prevKeys = periodKeys(period, shiftPeriod(period, anchor, -1), ws);
  const cur = useMemo(() => totals(keys, stat, today, over), [stat, keys.join(','), today, over]); // eslint-disable-line react-hooks/exhaustive-deps
  const prev = useMemo(() => totals(prevKeys, stat, today), [stat, prevKeys.join(','), today]); // eslint-disable-line react-hooks/exhaustive-deps
  const slices = useMemo(() => tagSlices(tasks, keys, settings.tags, C.faint), [tasks, keys.join(','), settings.tags]); // eslint-disable-line react-hooks/exhaustive-deps
  const streak = useMemo(() => perfectStreak(stat, first, today), [stat, first, today]);
  const recent = useMemo(() => Array.from({ length: 14 }, (_, i) => stat(addDays(today, i - 13))), [stat, today]);
  const routineList = useMemo(() => routines(tasks, today), [tasks, today]);
  const heat = useMemo(() => heatmap(stat, today, ws, HEAT_WEEKS), [stat, today, ws]);
  const rh = useMemo(() => rhythm(tasks, stat, today, RHYTHM_DAYS), [tasks, stat, today]);
  const openTodos = tasks.filter((t) => t.type === 'todo' && !t.done).length;

  const atNow = keys[keys.length - 1] >= today; // the current period — nothing ahead to show
  const { title, range } = periodTitle(period, anchor, ws, today);
  // Bars: the period's days (a single day shows its week, itself highlighted).
  const barDays = period === 'day' ? totals(periodKeys('week', anchor, ws), stat, today).days : cur.days;

  // Switching periods glides the period's cards sideways, like turning a page.
  const slideX = useSharedValue(0);
  const slideO = useSharedValue(1);
  const slide = useAnimatedStyle(() => ({ opacity: slideO.value, transform: [{ translateX: slideX.value }] }));
  const turn = (d: number) => {
    slideX.value = d * 22;
    slideX.value = withSpring(0, sp({ damping: 20, stiffness: 190 }));
    slideO.value = 0.35;
    slideO.value = withTiming(1, { duration: ms(240) });
  };
  const go = (d: number) => {
    if (d > 0 && atNow) return;
    Haptics.selectionAsync().catch(() => {});
    setDir(d);
    setAnchor((a) => shiftPeriod(period, a, d));
    turn(d);
  };
  const backToNow = () => {
    if (atNow) return;
    Haptics.selectionAsync().catch(() => {});
    setDir(1);
    setAnchor(today);
    turn(1);
  };
  const pickPeriod = (p: Period) => {
    if (p === period) return;
    Haptics.selectionAsync().catch(() => {});
    const order: Period[] = ['day', 'week', 'month'];
    const d = order.indexOf(p) > order.indexOf(period) ? 1 : -1;
    setDir(d);
    setPeriod(p);
    turn(d);
  };
  const swipe = Gesture.Pan()
    .activeOffsetX([-24, 24])
    .failOffsetY([-16, 16])
    .onEnd((e) => {
      'worklet';
      if (e.translationX > 60 || e.velocityX > 650) runOnJS(go)(-1);
      else if (e.translationX < -60 || e.velocityX < -650) runOnJS(go)(1);
    });

  // Against the period before: a finished period against the whole of that one;
  // one still running only over its days so far (Mon–Wed against last Mon–Wed),
  // so an unfinished week is never judged against a full one.
  const todayIdx = keys.indexOf(today);
  const cmp = useMemo((): Compare | null => {
    if (todayIdx < 0) return { a: cur, b: prev, pace: false };
    if (todayIdx === 0) return null; // its first day: nothing to compare yet
    return { a: totals(keys.slice(0, todayIdx), stat, today), b: totals(prevKeys.slice(0, todayIdx), stat, today), pace: true };
  }, [cur, prev, todayIdx, stat, today]); // eslint-disable-line react-hooks/exhaustive-deps

  const highlights = buildHighlights({ period, cur, cmp, slices, openTodos, today });

  return (
    <View style={styles.root}>
      <View style={[styles.head, { paddingTop: insets.top }]}>
        <Tappable onPress={onClose} hitSlop={10} style={styles.backBtn}>
          <Feather name="chevron-left" size={24} color={C.text} />
        </Tappable>
        <Text style={styles.headTitle}>Insights</Text>
        <View style={{ width: 40 }} />
      </View>

      <GestureDetector gesture={swipe}>
        <Animated.View style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ paddingTop: 4, paddingBottom: insets.bottom + 34, paddingHorizontal: 18 }} showsVerticalScrollIndicator={false}>
            <Appear from="up" distance={10}>
              <PeriodSwitch value={period} onChange={pickPeriod} />
            </Appear>
            <Appear from="up" delay={40} distance={10} style={styles.nav}>
              <Tappable onPress={() => go(-1)} hitSlop={8} style={styles.navBtn}>
                <Feather name="chevron-left" size={19} color={C.textDim} />
              </Tappable>
              <Tappable onPress={backToNow} scaleTo={0.97} style={styles.navMid}>
                <RollingText text={title} dir={dir} height={24} textStyle={styles.navTitle} />
                <Text style={styles.navRange}>{range}</Text>
              </Tappable>
              <Tappable onPress={() => go(1)} hitSlop={8} style={[styles.navBtn, atNow && styles.navOff]}>
                <Feather name="chevron-right" size={19} color={C.textDim} />
              </Tappable>
            </Appear>

            <Card delay={80} style={styles.heroCard}>
              <LinearGradient pointerEvents="none" colors={[hexA(C.accentA, 0.17), hexA(C.accentA, 0)]} start={{ x: 0, y: 0 }} end={{ x: 0.75, y: 0.9 }} style={StyleSheet.absoluteFill} />
              <Animated.View style={slide}>
                <Hero t={cur} cmp={cmp} period={period} dayWindow={settings.dayEnd - settings.dayStart} />
              </Animated.View>
            </Card>

            <StreakCard streak={streak} recent={recent} weekStart={ws} delay={130} />

            {highlights.length > 0 && (
              <Card title="Highlights" icon="star" tint={GOLD} delay={180}>
                <Animated.View style={slide}>
                  {highlights.map((h, i) => (
                    <Appear key={`${period}${anchor}${h.key}`} from="up" delay={40 + i * 45} distance={8} style={styles.hiRow}>
                      <View style={[styles.hiIcon, { backgroundColor: hexA(h.color, 0.14) }]}>
                        <Feather name={h.icon} size={14} color={h.color} />
                      </View>
                      <Text style={styles.hiTxt}>{h.text}</Text>
                    </Appear>
                  ))}
                </Animated.View>
              </Card>
            )}

            <Card title="Day by day" icon="bar-chart-2" tint={C.accentA} delay={230} right={<Legend />}>
              <Animated.View style={slide}>
                <DayBars days={barDays} today={today} focus={period === 'day' ? anchor : null} weekStart={ws} month={period === 'month'} onPick={onPickDay} />
              </Animated.View>
            </Card>

            <Card title="Where your time went" icon="pie-chart" tint={C.accentB} delay={280}>
              <Animated.View style={slide}>
                <TagBreakdown slices={slices} total={cur.sched} />
              </Animated.View>
            </Card>

            {routineList.length > 0 && (
              <Card title="Routines" icon="repeat" tint="#B57CF0" delay={330} right={<Text style={styles.cardNote}>repeating tasks</Text>}>
                {routineList.slice(0, 6).map((r, i) => (
                  <Appear key={r.id} from="up" delay={60 + i * 45} distance={8}>
                    <RoutineRow r={r} last={i === Math.min(5, routineList.length - 1)} />
                  </Appear>
                ))}
              </Card>
            )}

            <Card title="Consistency" icon="grid" tint={C.accentB} delay={380} right={<Text style={styles.cardNote}>last {HEAT_WEEKS} weeks</Text>}>
              <Heatmap cols={heat} today={today} weekStart={ws} onPick={onPickDay} />
            </Card>

            <Card title="Your rhythm" icon="activity" tint="#5B9DF9" delay={430} right={<Text style={styles.cardNote}>last 12 weeks</Text>}>
              <RhythmView rh={rh} clock={settings.clock} weekStart={ws} dayStart={settings.dayStart} dayEnd={settings.dayEnd} />
            </Card>
          </ScrollView>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

// ---- Building blocks ---------------------------------------------------------------

function Card({
  title,
  icon,
  tint = C.accentA,
  right,
  delay = 0,
  style,
  children,
}: {
  title?: string;
  icon?: keyof typeof Feather.glyphMap;
  tint?: string;
  right?: React.ReactNode;
  delay?: number;
  style?: object;
  children: React.ReactNode;
}) {
  return (
    <Appear from="up" delay={delay} distance={16} style={[styles.card, style]}>
      {!!title && (
        <View style={styles.cardHead}>
          {icon && (
            <View style={[styles.cardIcon, { backgroundColor: hexA(tint, 0.15) }]}>
              <Feather name={icon} size={13} color={tint} />
            </View>
          )}
          <Text style={styles.cardTitle}>{title}</Text>
          {right}
        </View>
      )}
      {children}
    </Appear>
  );
}

/** A number that counts up to its value (and glides between values). */
function useCountUp(target: number, duration = 750): number {
  const [v, setV] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const d = ms(duration);
    if (!d) {
      from.current = target;
      setV(target);
      return;
    }
    const a = from.current;
    const t0 = Date.now();
    let raf = 0;
    const step = () => {
      const k = Math.min(1, (Date.now() - t0) / d);
      const e = 1 - Math.pow(1 - k, 3);
      const x = a + (target - a) * e;
      from.current = x;
      setV(x);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return v;
}

function Count({ value, style, suffix = '' }: { value: number; style?: object; suffix?: string }) {
  const v = useCountUp(value);
  return (
    <Text style={style}>
      {Math.round(v)}
      {suffix}
    </Text>
  );
}

// Day / Week / Month, with a pill that slides to the choice.
function PeriodSwitch({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const items: { id: Period; label: string }[] = [
    { id: 'day', label: 'Day' },
    { id: 'week', label: 'Week' },
    { id: 'month', label: 'Month' },
  ];
  const idx = items.findIndex((i) => i.id === value);
  const w = useSharedValue(0);
  const x = useSharedValue(idx);
  useEffect(() => {
    x.value = withSpring(idx, sp({ damping: 20, stiffness: 240 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);
  const pill = useAnimatedStyle(() => ({ width: w.value / 3, opacity: w.value ? 1 : 0, transform: [{ translateX: (x.value * w.value) / 3 }] }));
  return (
    <View style={styles.seg} onLayout={(e) => (w.value = e.nativeEvent.layout.width - 8)}>
      <Animated.View pointerEvents="none" style={[styles.segPill, pill]}>
        <LinearGradient colors={[C.accentB, '#46bdb2']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
      {items.map((i) => (
        <Tappable key={i.id} onPress={() => onChange(i.id)} scaleTo={0.94} style={styles.segBtn}>
          <Text style={[styles.segTxt, i.id === value && styles.segTxtOn]}>{i.label}</Text>
        </Tappable>
      ))}
    </View>
  );
}

// ---- Hero: how much got done ---------------------------------------------------------

const ACircle = Animated.createAnimatedComponent(Circle);

function Ring({ pct, size, stroke, children }: { pct: number; size: number; stroke: number; children?: React.ReactNode }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withTiming(pct, { duration: ms(950), easing: Easing.out(Easing.cubic) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pct]);
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const arc = useAnimatedProps(() => ({ strokeDashoffset: circ * (1 - p.value), strokeOpacity: p.value > 0.004 ? 1 : 0 }));
  const c = size / 2;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Defs>
          <SvgGrad id="heroRing" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={C.accentA} />
            <Stop offset="1" stopColor={C.accentB} />
          </SvgGrad>
        </Defs>
        <Circle cx={c} cy={c} r={r} stroke="rgba(255,255,255,0.07)" strokeWidth={stroke} fill="none" />
        <ACircle
          cx={c}
          cy={c}
          r={r}
          stroke="url(#heroRing)"
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${circ} ${circ}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${c} ${c})`}
          animatedProps={arc}
        />
      </Svg>
      <View style={styles.ringCenter}>{children}</View>
    </View>
  );
}

type Compare = { a: Totals; b: Totals; pace: boolean };

function Hero({ t, cmp, period, dayWindow }: { t: Totals; cmp: Compare | null; period: Period; dayWindow: number }) {
  const pct = t.total ? t.done / t.total : 0;
  const delta = cmp && cmp.a.total && cmp.b.total ? Math.round((cmp.a.done / cmp.a.total - cmp.b.done / cmp.b.total) * 100) : null;
  // Free time inside the day window — per day on average over a week / month,
  // where a grand total (e.g. "105h") would say nothing.
  const days = t.days.length;
  const free = Math.max(0, Math.round((dayWindow * days - t.sched) / days));
  const empty = t.total === 0;
  return (
    <>
      <View style={styles.heroRow}>
        <Ring pct={pct} size={118} stroke={12}>
          {empty ? <Text style={styles.ringPct}>–</Text> : <Count value={pct * 100} suffix="%" style={styles.ringPct} />}
          <Text style={styles.ringSub}>done</Text>
        </Ring>
        <View style={styles.heroMeta}>
          <Text style={styles.heroBig}>
            <Count value={t.done} style={styles.heroBig} />
            {!empty && <Text style={styles.heroOf}> of {t.total}</Text>}
          </Text>
          <Text style={styles.heroLbl}>{empty ? 'tasks planned' : t.total === 1 ? 'task completed' : 'tasks completed'}</Text>
          {empty ? (
            <Text style={styles.heroNote}>Nothing planned this {period}.</Text>
          ) : delta != null ? (
            <Delta value={delta} period={period} pace={!!cmp?.pace} />
          ) : null}
        </View>
      </View>
      <View style={styles.tiles}>
        <Tile icon="check-circle" color={C.accentB} value={hoursLabel(t.doneMin)} label="Done" />
        <Tile icon="clock" color={C.accentA} value={hoursLabel(t.sched)} label="Planned" />
        <Tile icon="sun" color={GOLD} value={hoursLabel(free)} label={period === 'day' ? 'Free' : 'Free / day'} />
      </View>
    </>
  );
}

// Completion rate against the period before ("12% better than the week
// before"), or while the period is running, against the same point of it.
function Delta({ value, period, pace }: { value: number; period: Period; pace: boolean }) {
  const up = value > 0;
  const flat = value === 0;
  const color = flat ? C.muted : up ? C.accentB : C.danger;
  const vs = pace ? prevPoint(period) : prevName(period);
  const text = flat ? (pace ? `On par with ${vs}` : `Same as ${vs}`) : `${Math.abs(value)}% ${up ? (pace ? 'ahead of' : 'better than') : pace ? 'behind' : 'lower than'} ${vs}`;
  return (
    <Appear key={`${value}${pace}`} from="left" distance={8} style={[styles.delta, { backgroundColor: hexA(flat ? '#ffffff' : color, flat ? 0.06 : 0.13) }]}>
      <Feather name={flat ? 'minus' : up ? 'trending-up' : 'trending-down'} size={12} color={color} />
      <Text style={[styles.deltaTxt, { color }]}>{text}</Text>
    </Appear>
  );
}

function Tile({ icon, color, value, label }: { icon: keyof typeof Feather.glyphMap; color: string; value: string; label: string }) {
  return (
    <View style={styles.tile}>
      <Feather name={icon} size={13} color={color} />
      <Text style={styles.tileVal}>{value}</Text>
      <Text style={styles.tileLbl}>{label}</Text>
    </View>
  );
}

// ---- Streak ------------------------------------------------------------------------------

function StreakCard({ streak, recent, weekStart, delay }: { streak: Streak; recent: DayStat[]; weekStart: WeekStart; delay: number }) {
  const active = streak.current > 0;
  const today = recent[recent.length - 1];
  const left = today.total - today.done;

  // The flame breathes while the streak is alive.
  const b = useSharedValue(1);
  useEffect(() => {
    if (active && motion.enabled) {
      b.value = withRepeat(withSequence(withTiming(1.07, { duration: ms(950), easing: Easing.inOut(Easing.sin) }), withTiming(1, { duration: ms(950), easing: Easing.inOut(Easing.sin) })), -1);
    } else b.value = withTiming(1, { duration: ms(200) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  const flame = useAnimatedStyle(() => ({ transform: [{ scale: b.value }] }));

  let hint: string;
  if (today.state === 'perfect') hint = active ? `Today’s all done — ${plural(streak.current, 'day')} and counting.` : 'Today’s all done.';
  else if (today.total > 0) hint = active ? `Finish today’s ${plural(left, 'remaining task')} to make it ${plural(streak.current + 1, 'day')}.` : `Finish all ${plural(left, 'task')} planned today to start a streak.`;
  else hint = active ? 'Nothing planned today — your streak is safe.' : 'Plan a day and finish all of it to start a streak.';

  const letters = DOW.map((d) => d[0]); // Mon..Sun
  const letterOf = (key: string) => letters[(dateFromKey(key).getDay() + 6) % 7];
  const record = active && streak.current >= streak.best && streak.best > 1;

  return (
    <Card delay={delay} style={styles.streakCard}>
      <LinearGradient pointerEvents="none" colors={[hexA(FLAME[0], active ? 0.14 : 0.04), hexA(FLAME[1], 0)]} start={{ x: 0, y: 0 }} end={{ x: 0.8, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={styles.streakTop}>
        <Animated.View style={flame}>
          <LinearGradient colors={active ? FLAME : ['#2a2b31', '#1d1e22']} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={[styles.flame, active && { boxShadow: `0 8px 22px -8px ${hexA(FLAME[1], 0.9)}` }]}>
            <Text style={[styles.flameTxt, !active && styles.flameOff]}>🔥</Text>
          </LinearGradient>
        </Animated.View>
        <View style={{ flex: 1 }}>
          <Text style={styles.streakBig}>
            <Count value={streak.current} style={styles.streakBig} />
            <Text style={styles.streakUnit}> {streak.current === 1 ? 'day' : 'days'}</Text>
          </Text>
          <Text style={styles.streakLbl}>{record ? 'Current streak · your best yet' : 'Current streak'}</Text>
        </View>
        <View style={styles.best}>
          <Feather name="award" size={15} color={GOLD} />
          <Text style={styles.bestVal}>{streak.best}</Text>
          <Text style={styles.bestLbl}>best</Text>
        </View>
      </View>

      <View style={styles.dots}>
        {recent.map((d, i) => (
          <View key={d.key} style={styles.dotCol}>
            <Text style={[styles.dotLetter, i === recent.length - 1 && { color: C.text }]}>{letterOf(d.key)}</Text>
            <Appear from="pop" delay={120 + i * 28}>
              <StreakDot s={d} />
            </Appear>
          </View>
        ))}
      </View>

      <View style={styles.streakHint}>
        <Feather name={today.state === 'perfect' ? 'check-circle' : active ? 'zap' : 'target'} size={13} color={today.state === 'perfect' ? C.accentB : FLAME[0]} />
        <Text style={styles.streakHintTxt}>{hint}</Text>
      </View>
      <Text style={styles.footnote}>A streak counts days you finish everything you planned. Days with nothing planned don’t break it.</Text>
    </Card>
  );
}

function StreakDot({ s }: { s: DayStat }) {
  switch (s.state) {
    case 'perfect':
      return (
        <LinearGradient colors={FLAME} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={styles.dot}>
          <Feather name="check" size={10} color="#0b0b0d" />
        </LinearGradient>
      );
    case 'partial':
      return <View style={[styles.dot, { backgroundColor: hexA(FLAME[0], 0.26) }]} />;
    case 'missed':
      return <View style={[styles.dot, { borderWidth: 1.5, borderColor: hexA(C.danger, 0.55) }]} />;
    case 'open':
      return <View style={[styles.dot, { borderWidth: 1.5, borderStyle: 'dashed', borderColor: hexA(FLAME[0], 0.85) }]} />;
    default:
      return (
        <View style={styles.dot}>
          <View style={styles.dotEmpty} />
        </View>
      );
  }
}

// ---- Highlights ------------------------------------------------------------------------------

type Highlight = { key: string; icon: keyof typeof Feather.glyphMap; color: string; text: string };

function buildHighlights({ period, cur, cmp, slices, openTodos, today }: { period: Period; cur: Totals; cmp: Compare | null; slices: TagSlice[]; openTodos: number; today: string }): Highlight[] {
  const out: Highlight[] = [];
  // The best day of the week / month.
  // The best day of the week / month — once there are days to compare and it
  // actually went well.
  const planned = cur.days.filter((d) => d.key <= today && d.total > 0);
  if (period !== 'day' && planned.length >= 2) {
    let best: DayStat | null = null;
    for (const d of planned) {
      if (d.total < 2) continue;
      if (!best || d.done / d.total > best.done / best.total || (d.done / d.total === best.done / best.total && d.done > best.done)) best = d;
    }
    if (best && best.done / best.total >= 0.5) {
      const dt = dateFromKey(best.key);
      const name = period === 'week' ? WEEKDAYS_FULL[dt.getDay()] : `${MONTHS[dt.getMonth()].slice(0, 3)} ${dt.getDate()}`;
      out.push({ key: 'best', icon: 'award', color: GOLD, text: `${name} was your best day — ${best.done} of ${best.total} done.` });
    }
  }
  if (cur.slipped > 0) out.push({ key: 'slip', icon: 'alert-circle', color: C.danger, text: `${plural(cur.slipped, 'task')} slipped by — past and not done.` });
  if (slices.length > 1 && slices[0].share >= 0.3) out.push({ key: 'tag', icon: 'tag', color: slices[0].color, text: `${slices[0].name} took ${Math.round(slices[0].share * 100)}% of your planned time.` });
  if (cmp && cmp.b.total > 0) {
    const diff = cmp.a.done - cmp.b.done;
    const vs = cmp.pace ? prevPoint(period) : prevName(period);
    if (diff !== 0) out.push({ key: 'diff', icon: diff > 0 ? 'trending-up' : 'trending-down', color: diff > 0 ? C.accentB : C.muted, text: `${plural(Math.abs(diff), 'task')} ${diff > 0 ? 'more' : 'fewer'} done than ${vs}.` });
  }
  if (openTodos > 0) out.push({ key: 'todo', icon: 'check-square', color: C.accentA, text: `${plural(openTodos, 'to-do')} waiting in your list.` });
  return out.slice(0, 3);
}

// ---- Day by day --------------------------------------------------------------------------------

function Legend() {
  return (
    <View style={styles.legend}>
      <View style={[styles.legendDot, { backgroundColor: C.accentB }]} />
      <Text style={styles.legendTxt}>Done</Text>
      <View style={[styles.legendDot, { backgroundColor: 'rgba(255,255,255,0.22)', marginLeft: 8 }]} />
      <Text style={styles.legendTxt}>Planned</Text>
    </View>
  );
}

const BAR_H = 118;

function DayBars({ days, today, focus, weekStart, month, onPick }: { days: DayStat[]; today: string; focus: string | null; weekStart: WeekStart; month: boolean; onPick: (key: string) => void }) {
  const max = Math.max(60, ...days.map((d) => d.sched));
  const letters = weekdayLetters(weekStart);
  const peak = days.reduce((m, d) => Math.max(m, d.sched), 0);
  return (
    <>
      <View style={styles.barsTop}>
        <Text style={styles.barsMax}>{peak ? `busiest ${hoursLabel(peak)}` : 'nothing planned'}</Text>
      </View>
      <View style={[styles.bars, month && styles.barsMonth]}>
        {days.map((d, i) => {
          const isToday = d.key === today;
          const on = focus === d.key;
          const n = dateFromKey(d.key).getDate();
          const label = month ? (n === 1 || n % 7 === 1 ? String(n) : '') : letters[i];
          return (
            <Tappable key={d.key} onPress={() => onPick(d.key)} scaleTo={0.92} style={styles.barCol}>
              <View style={styles.barTrack}>
                <Bar h={(d.sched / max) * BAR_H} fill={d.sched ? d.doneMin / d.sched : 0} delay={i * (month ? 12 : 40)} width={month ? 6 : 22} strong={isToday || on} future={d.key > today} />
              </View>
              <Text numberOfLines={1} style={[styles.barLbl, month && styles.barLblMonth, (isToday || on) && { color: C.text }]}>
                {label}
              </Text>
              <View style={[styles.barMark, { backgroundColor: on ? C.accentB : isToday ? C.text : 'transparent' }]} />
            </Tappable>
          );
        })}
      </View>
    </>
  );
}

function Bar({ h, fill, delay, width, strong, future }: { h: number; fill: number; delay: number; width: number; strong: boolean; future: boolean }) {
  const H = useSharedValue(0);
  const F = useSharedValue(0);
  useEffect(() => {
    H.value = withDelay(ms(delay), withSpring(h, sp({ damping: 18, stiffness: 160 })));
    F.value = withDelay(ms(delay + 120), withSpring(fill, sp({ damping: 20, stiffness: 160 })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h, fill]);
  // A day with nothing planned keeps a faint stub, so the axis reads as days.
  const outer = useAnimatedStyle(() => ({ height: Math.max(H.value, 5) }));
  const inner = useAnimatedStyle(() => ({ height: `${Math.min(1, Math.max(0, F.value)) * 100}%` }));
  const r = Math.min(7, width / 2);
  return (
    <Animated.View style={[styles.bar, { width, borderRadius: r, backgroundColor: h < 1 ? 'rgba(255,255,255,0.05)' : future ? 'rgba(255,255,255,0.07)' : strong ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.11)' }, outer]}>
      <Animated.View style={[styles.barFill, { borderRadius: r }, inner]}>
        <LinearGradient colors={[C.accentB, C.accentA]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
    </Animated.View>
  );
}

// ---- Where your time went -----------------------------------------------------------------------

const DONUT = 132;
const DONUT_W = 16;

function TagBreakdown({ slices, total }: { slices: TagSlice[]; total: number }) {
  if (!slices.length) {
    return (
      <View style={styles.emptyBox}>
        <Feather name="pie-chart" size={20} color={C.faint} />
        <Text style={styles.emptyTxt}>No planned time in this period yet.</Text>
      </View>
    );
  }
  // Up to five slices; the rest become "Other".
  const shown = slices.slice(0, 5);
  if (slices.length > 5) {
    const rest = slices.slice(5);
    shown.push({
      id: '__other',
      name: 'Other',
      color: '#6a6a72',
      mins: rest.reduce((n, s) => n + s.mins, 0),
      share: rest.reduce((n, s) => n + s.share, 0),
      total: rest.reduce((n, s) => n + s.total, 0),
      done: rest.reduce((n, s) => n + s.done, 0),
    });
  }
  return (
    <View style={styles.tagWrap}>
      <Donut slices={shown}>
        <Text style={styles.donutVal}>{hoursLabel(total)}</Text>
        <Text style={styles.donutLbl}>planned</Text>
      </Donut>
      <View style={styles.tagList}>
        {shown.map((s, i) => (
          <Appear key={s.id} from="left" delay={80 + i * 50} distance={10} style={styles.tagRow}>
            <View style={[styles.tagDot, { backgroundColor: s.color }]} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={styles.tagLine}>
                <Text style={styles.tagName} numberOfLines={1}>
                  {s.name}
                </Text>
                <Text style={styles.tagShare}>{Math.round(s.share * 100)}%</Text>
              </View>
              <Text style={styles.tagSub} numberOfLines={1}>
                {hoursLabel(s.mins)} · {pctOf(s.done, s.total)}% done
              </Text>
            </View>
          </Appear>
        ))}
      </View>
    </View>
  );
}

function Donut({ slices, children }: { slices: TagSlice[]; children: React.ReactNode }) {
  const p = useSharedValue(0);
  const sig = slices.map((s) => `${s.id}:${s.mins}`).join('|');
  useEffect(() => {
    p.value = 0;
    p.value = withTiming(1, { duration: ms(900), easing: Easing.out(Easing.cubic) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  const r = (DONUT - DONUT_W) / 2;
  const circ = 2 * Math.PI * r;
  const gap = slices.length > 1 ? 0.012 : 0; // share of the circle left between slices
  let at = 0;
  return (
    <View style={{ width: DONUT, height: DONUT }}>
      <Svg width={DONUT} height={DONUT}>
        <Circle cx={DONUT / 2} cy={DONUT / 2} r={r} stroke="rgba(255,255,255,0.05)" strokeWidth={DONUT_W} fill="none" />
        {slices.map((s) => {
          const start = at;
          at += s.share;
          return <Slice key={s.id} p={p} start={start} share={Math.max(0.004, s.share - gap)} color={s.color} r={r} circ={circ} />;
        })}
      </Svg>
      <View style={styles.ringCenter}>{children}</View>
    </View>
  );
}

// One slice: revealed clockwise as the donut's sweep passes over it.
function Slice({ p, start, share, color, r, circ }: { p: SharedValue<number>; start: number; share: number; color: string; r: number; circ: number }) {
  const len = share * circ;
  const props = useAnimatedProps(() => {
    const k = Math.min(1, Math.max(0, (p.value - start) / Math.max(0.0001, share)));
    return { strokeDashoffset: len * (1 - k), strokeOpacity: k > 0.01 ? 1 : 0 };
  });
  const c = DONUT / 2;
  return (
    <ACircle
      cx={c}
      cy={c}
      r={r}
      stroke={color}
      strokeWidth={DONUT_W}
      fill="none"
      strokeDasharray={`${len} ${circ}`}
      transform={`rotate(${start * 360 - 90} ${c} ${c})`}
      animatedProps={props}
    />
  );
}

// ---- Routines --------------------------------------------------------------------------------------

function RoutineRow({ r, last }: { r: Routine; last: boolean }) {
  const hot = r.current > 0;
  return (
    <View style={[styles.rtRow, !last && styles.rtDivider]}>
      <LinearGradient colors={[r.color, hexA(r.color, 0.72)]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={styles.rtIcon}>
        <Text style={styles.rtEmoji}>{r.emoji}</Text>
      </LinearGradient>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rtTitle} numberOfLines={1}>
          {r.title}
        </Text>
        <Text style={styles.rtSub} numberOfLines={1}>
          {Math.round(r.rate * 100)}% kept · best {r.best}
        </Text>
      </View>
      <View style={styles.rtRight}>
        <View style={[styles.rtStreak, { backgroundColor: hot ? hexA(FLAME[0], 0.15) : 'rgba(255,255,255,0.05)' }]}>
          <Text style={[styles.rtFire, !hot && styles.flameOff]}>🔥</Text>
          <Text style={[styles.rtStreakTxt, { color: hot ? FLAME[0] : C.muted }]}>{r.current}</Text>
        </View>
        <View style={styles.rtMarks}>
          {r.recent.map((m, i) => (
            <View
              key={i}
              style={[
                styles.rtMark,
                m === 'done' ? { backgroundColor: r.color } : m === 'pending' ? { borderWidth: 1, borderStyle: 'dashed', borderColor: hexA(r.color, 0.8) } : { borderWidth: 1, borderColor: hexA(C.danger, 0.5) },
              ]}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

// ---- Consistency ---------------------------------------------------------------------------------------

const HEAT_GAP = 3;

function heatColor(c: HeatCell): string {
  switch (c.state) {
    case 'future':
      return 'rgba(255,255,255,0.018)';
    case 'empty':
      return 'rgba(255,255,255,0.05)';
    case 'missed':
      return hexA(C.danger, 0.24);
    case 'perfect':
      return C.accentB;
    default:
      return hexA(C.accentB, 0.18 + 0.5 * c.ratio);
  }
}

function Heatmap({ cols, today, weekStart, onPick }: { cols: HeatCell[][]; today: string; weekStart: WeekStart; onPick: (key: string) => void }) {
  const [w, setW] = useState(0);
  const labelW = 16;
  const cell = w ? Math.floor((w - labelW - HEAT_GAP * (cols.length - 1)) / cols.length) : 0;
  const letters = weekdayLetters(weekStart);
  const flat = cols.flat().filter((c) => c.state !== 'future');
  const active = flat.filter((c) => c.state !== 'empty' && c.state !== 'missed').length;
  const perfect = flat.filter((c) => c.state === 'perfect').length;
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {cell > 0 && (
        <>
          {/* Month names over the week each month starts in (the first column
              is named too, unless a new month follows right after it). */}
          <View style={[styles.heatMonths, { marginLeft: labelW }]}>
            {monthMarks(cols).map((m) => (
              <Text key={m.col} numberOfLines={1} style={[styles.heatMonth, { left: m.col * (cell + HEAT_GAP) }]}>
                {m.label}
              </Text>
            ))}
          </View>
          <View style={styles.heatBody}>
            <View style={{ width: labelW }}>
              {letters.map((l, i) => (
                <Text key={i} style={[styles.heatDay, { height: cell, marginBottom: i < 6 ? HEAT_GAP : 0, lineHeight: cell }]}>
                  {i % 2 === 0 ? l : ''}
                </Text>
              ))}
            </View>
            {cols.map((col, ci) => (
              <Appear key={ci} from="up" delay={60 + ci * 22} distance={6} style={{ marginRight: ci < cols.length - 1 ? HEAT_GAP : 0 }}>
                {col.map((c, ri) => (
                  <Pressable
                    key={c.key}
                    disabled={c.state === 'future'}
                    onPress={() => onPick(c.key)}
                    hitSlop={1}
                    style={({ pressed }) => [
                      styles.heatCell,
                      { width: cell, height: cell, borderRadius: Math.max(3, cell * 0.28), marginBottom: ri < 6 ? HEAT_GAP : 0, backgroundColor: heatColor(c) },
                      c.key === today && styles.heatToday,
                      pressed && { opacity: 0.55 },
                    ]}
                  />
                ))}
              </Appear>
            ))}
          </View>
          <View style={styles.heatFoot}>
            <Text style={styles.heatSum}>
              {plural(active, 'active day')} · {perfect} perfect
            </Text>
            <View style={styles.heatKey}>
              <Text style={styles.heatKeyTxt}>Less</Text>
              {[0.05, 0.3, 0.5, 0.68].map((a, i) => (
                <View key={i} style={[styles.heatKeyCell, { backgroundColor: i === 0 ? 'rgba(255,255,255,0.05)' : hexA(C.accentB, a) }]} />
              ))}
              <View style={[styles.heatKeyCell, { backgroundColor: C.accentB }]} />
              <Text style={styles.heatKeyTxt}>More</Text>
            </View>
          </View>
        </>
      )}
    </View>
  );
}

function monthMarks(cols: HeatCell[][]): { col: number; label: string }[] {
  const out: { col: number; label: string }[] = [];
  cols.forEach((col, i) => {
    const first = col.find((c) => dateFromKey(c.key).getDate() === 1);
    if (first) out.push({ col: i, label: MONTHS[dateFromKey(first.key).getMonth()].slice(0, 3) });
  });
  if (!out.length || out[0].col > 2) out.unshift({ col: 0, label: MONTHS[dateFromKey(cols[0][0].key).getMonth()].slice(0, 3) });
  return out;
}

// ---- Rhythm ------------------------------------------------------------------------------------------------

const hourName = (h: number, clock: Clock) => fmt(h * 60, clock).replace(':00', '');

function RhythmView({ rh, clock, weekStart, dayStart, dayEnd }: { rh: Rhythm; clock: Clock; weekStart: WeekStart; dayStart: number; dayEnd: number }) {
  if (rh.completed < 5) {
    return (
      <View style={styles.emptyBox}>
        <Feather name="activity" size={20} color={C.faint} />
        <Text style={styles.emptyTxt}>Complete a few more tasks and your rhythm shows up here — when you get the most done, and your strongest days.</Text>
      </View>
    );
  }
  // Hours of the visible day (plus any hour where something got done).
  let h0 = Math.floor(dayStart / 60);
  let h1 = Math.ceil(dayEnd / 60) - 1;
  rh.hours.forEach((v, h) => {
    if (v > 0) {
      h0 = Math.min(h0, h);
      h1 = Math.max(h1, h);
    }
  });
  const hrs = Array.from({ length: h1 - h0 + 1 }, (_, i) => h0 + i);
  const maxH = Math.max(1, ...hrs.map((h) => rh.hours[h]));
  const order = weekStart === 'mon' ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
  const letters = weekdayLetters(weekStart);
  const rate = (d: number) => (rh.weekdays[d].total ? rh.weekdays[d].done / rh.weekdays[d].total : 0);
  return (
    <>
      {rh.peak != null && (
        <Text style={styles.rhHead}>
          You get the most done around <Text style={styles.rhEm}>{fmt(rh.peak * 60, clock)}</Text>.
        </Text>
      )}
      <View style={styles.hist}>
        {hrs.map((h, i) => (
          <View key={h} style={styles.histCol}>
            <View style={styles.histTrack}>
              <HistBar h={(rh.hours[h] / maxH) * 70} peak={h === rh.peak} delay={i * 18} />
            </View>
            <Text style={[styles.histLbl, h === rh.peak && { color: C.text }]}>{(h - h0) % 3 === 0 ? hourName(h, clock) : ''}</Text>
          </View>
        ))}
      </View>

      <View style={styles.rhDivider} />

      {rh.best != null && (
        <Text style={styles.rhHead}>
          <Text style={styles.rhEm}>{WEEKDAYS_FULL[rh.best]}s</Text> are your strongest — {Math.round(rate(rh.best) * 100)}% done.
        </Text>
      )}
      <View style={styles.wk}>
        {order.map((d, i) => {
          const v = rate(d);
          const best = d === rh.best;
          return (
            <View key={d} style={styles.wkCol}>
              <Text style={[styles.wkPct, best && { color: C.accentB }]}>{rh.weekdays[d].total ? `${Math.round(v * 100)}` : '–'}</Text>
              <View style={styles.wkTrack}>
                <HistBar h={v * 54} peak={best} delay={i * 35} />
              </View>
              <Text style={[styles.wkLbl, best && { color: C.text }]}>{letters[i]}</Text>
            </View>
          );
        })}
      </View>
    </>
  );
}

function HistBar({ h, peak, delay }: { h: number; peak: boolean; delay: number }) {
  const H = useSharedValue(0);
  useEffect(() => {
    H.value = withDelay(ms(delay), withSpring(h, sp({ damping: 18, stiffness: 170 })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h]);
  const a = useAnimatedStyle(() => ({ height: H.value > 0.5 ? Math.max(3, H.value) : 0 }));
  return (
    <Animated.View style={[styles.histBar, !peak && { backgroundColor: 'rgba(255,255,255,0.14)' }, a]}>
      {peak && <LinearGradient colors={[C.accentB, C.accentA]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700', color: C.text },

  seg: { flexDirection: 'row', padding: 4, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.05)' },
  segPill: { position: 'absolute', top: 4, bottom: 4, left: 4, borderRadius: 11, overflow: 'hidden', boxShadow: '0 6px 16px -6px rgba(79,209,197,0.7)' },
  segBtn: { flex: 1, height: 38, alignItems: 'center', justifyContent: 'center' },
  segTxt: { fontSize: 13.5, fontWeight: '700', color: C.textDim },
  segTxtOn: { color: '#0b0b0d' },

  nav: { flexDirection: 'row', alignItems: 'center', marginTop: 12, marginBottom: 14 },
  navBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
  navOff: { opacity: 0.28 },
  navMid: { flex: 1, alignItems: 'center' },
  navTitle: { fontSize: 17, fontWeight: '800', color: C.text },
  navRange: { fontSize: 12, fontWeight: '600', color: C.muted, marginTop: 1, fontVariant: ['tabular-nums'] },

  card: { backgroundColor: C.card, borderRadius: 22, padding: 18, marginBottom: 14, overflow: 'hidden', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.05)' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 14 },
  cardIcon: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: C.text },
  cardNote: { fontSize: 11.5, fontWeight: '600', color: C.faint },

  heroCard: { paddingVertical: 20 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  ringCenter: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  ringPct: { fontSize: 26, fontWeight: '800', color: C.text, fontVariant: ['tabular-nums'] },
  ringSub: { fontSize: 11, fontWeight: '700', color: C.muted, marginTop: -2 },
  heroMeta: { flex: 1, minWidth: 0 },
  heroBig: { fontSize: 34, fontWeight: '800', color: C.text, fontVariant: ['tabular-nums'] },
  heroOf: { fontSize: 20, fontWeight: '700', color: C.faint },
  heroLbl: { fontSize: 13, fontWeight: '600', color: C.muted, marginTop: 1 },
  heroNote: { fontSize: 12.5, fontWeight: '600', color: C.faint, marginTop: 10 },
  delta: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', marginTop: 10, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 9 },
  deltaTxt: { fontSize: 11.5, fontWeight: '800', flexShrink: 1 },
  tiles: { flexDirection: 'row', gap: 8, marginTop: 18 },
  tile: { flex: 1, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 14, paddingVertical: 11, alignItems: 'center', gap: 3 },
  tileVal: { fontSize: 16.5, fontWeight: '800', color: C.text, fontVariant: ['tabular-nums'] },
  tileLbl: { fontSize: 11, color: C.muted, fontWeight: '700' },

  streakCard: {},
  streakTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  flame: { width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  flameTxt: { fontSize: 27 },
  flameOff: { opacity: 0.35 },
  streakBig: { fontSize: 30, fontWeight: '800', color: C.text, fontVariant: ['tabular-nums'] },
  streakUnit: { fontSize: 17, fontWeight: '700', color: C.muted },
  streakLbl: { fontSize: 12.5, fontWeight: '700', color: C.muted, marginTop: 1 },
  best: { alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, backgroundColor: hexA(GOLD, 0.09) },
  bestVal: { fontSize: 18, fontWeight: '800', color: C.text, fontVariant: ['tabular-nums'], marginTop: 2 },
  bestLbl: { fontSize: 10.5, fontWeight: '700', color: C.muted },
  dots: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 18 },
  dotCol: { alignItems: 'center', gap: 6 },
  dotLetter: { fontSize: 10, fontWeight: '700', color: C.faint },
  dot: { width: 19, height: 19, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  dotEmpty: { width: 5, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.14)' },
  streakHint: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.04)' },
  streakHintTxt: { flex: 1, fontSize: 13, fontWeight: '600', color: C.textDim, lineHeight: 18 },
  footnote: { fontSize: 11, color: C.faint, marginTop: 10, lineHeight: 15 },

  hiRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 7 },
  hiIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  hiTxt: { flex: 1, fontSize: 13.5, fontWeight: '600', color: C.textDim, lineHeight: 19 },

  legend: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 3 },
  legendTxt: { fontSize: 11, color: C.muted, fontWeight: '600' },
  barsTop: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: -6, marginBottom: 6 },
  barsMax: { fontSize: 11, fontWeight: '600', color: C.faint },
  bars: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  barsMonth: { justifyContent: 'space-between' },
  barCol: { flex: 1, alignItems: 'center' },
  barTrack: { height: BAR_H, justifyContent: 'flex-end' },
  bar: { justifyContent: 'flex-end', overflow: 'hidden' },
  barFill: { width: '100%', overflow: 'hidden' },
  barLbl: { fontSize: 10.5, fontWeight: '700', color: C.faint, marginTop: 8, height: 14 },
  barLblMonth: { width: 26, textAlign: 'center' }, // wider than its column (centred over it)
  barMark: { width: 4, height: 4, borderRadius: 2, marginTop: 3 },

  tagWrap: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  donutVal: { fontSize: 19, fontWeight: '800', color: C.text, fontVariant: ['tabular-nums'] },
  donutLbl: { fontSize: 11, fontWeight: '700', color: C.muted },
  tagList: { flex: 1, minWidth: 0, gap: 9 },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  tagDot: { width: 10, height: 10, borderRadius: 4 },
  tagLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tagName: { flex: 1, fontSize: 13.5, fontWeight: '700', color: C.textDim },
  tagShare: { fontSize: 13, fontWeight: '800', color: C.text, fontVariant: ['tabular-nums'] },
  tagSub: { fontSize: 11, fontWeight: '600', color: C.muted, marginTop: 1, fontVariant: ['tabular-nums'] },

  rtRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  rtDivider: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  rtIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rtEmoji: { fontSize: 18 },
  rtTitle: { fontSize: 14.5, fontWeight: '700', color: C.text },
  rtSub: { fontSize: 11.5, fontWeight: '600', color: C.muted, marginTop: 2 },
  rtRight: { alignItems: 'flex-end', gap: 6 },
  rtStreak: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 9 },
  rtFire: { fontSize: 11 },
  rtStreakTxt: { fontSize: 12.5, fontWeight: '800', fontVariant: ['tabular-nums'] },
  rtMarks: { flexDirection: 'row', gap: 3 },
  rtMark: { width: 7, height: 7, borderRadius: 4 },

  heatMonths: { height: 14, marginBottom: 5 },
  heatMonth: { position: 'absolute', top: 0, width: 40, fontSize: 10, fontWeight: '700', color: C.faint },
  heatBody: { flexDirection: 'row' },
  heatDay: { fontSize: 9.5, fontWeight: '700', color: C.faint },
  heatCell: {},
  heatToday: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.75)' },
  heatFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  heatSum: { fontSize: 11.5, fontWeight: '700', color: C.muted },
  heatKey: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  heatKeyTxt: { fontSize: 10, fontWeight: '600', color: C.faint, marginHorizontal: 2 },
  heatKeyCell: { width: 10, height: 10, borderRadius: 3 },

  rhHead: { fontSize: 13.5, fontWeight: '600', color: C.textDim, marginBottom: 12, lineHeight: 19 },
  rhEm: { fontWeight: '800', color: C.text },
  hist: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  histCol: { flex: 1, alignItems: 'center' },
  histTrack: { height: 70, justifyContent: 'flex-end', width: '100%' },
  histBar: { width: '100%', borderRadius: 3, overflow: 'hidden' },
  histLbl: { fontSize: 9.5, fontWeight: '700', color: C.faint, marginTop: 6, height: 12, width: 40, textAlign: 'center' },
  rhDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginVertical: 16 },
  wk: { flexDirection: 'row', justifyContent: 'space-between' },
  wkCol: { alignItems: 'center', flex: 1 },
  wkPct: { fontSize: 10.5, fontWeight: '800', color: C.muted, marginBottom: 5, fontVariant: ['tabular-nums'] },
  wkTrack: { height: 54, width: 20, justifyContent: 'flex-end' },
  wkLbl: { fontSize: 10.5, fontWeight: '700', color: C.faint, marginTop: 7 },

  emptyBox: { alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 10 },
  emptyTxt: { fontSize: 13, color: C.muted, textAlign: 'center', lineHeight: 18 },
});
