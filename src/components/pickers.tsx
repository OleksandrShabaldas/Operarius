import React, { useEffect, useRef, useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  interpolateColor,
  runOnJS,
  SharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Line as SvgLine } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { C, MONTHS } from '../theme';
import { Clock } from '../types';
import { dateFromKey, dateKey, fmt, fmtDur, todayKey, weekdayLetters } from '../utils';
import { CenterPopup as Popup } from './Overlay';
import { Appear, Tappable } from './anim';
import { sp } from '../motion';

// The recessed drum "deck": a shaded card holding one or more wheel columns,
// with a highlighted centre band and a soft top/bottom vignette so the whole
// chip reads as a rounded 3D drum (not two stray lines). `rows` (odd) sets
// how many rows show — the default 5, or a compact 3.
export function WheelDeck({ children, rows = VISIBLE }: { children: React.ReactNode; rows?: number }) {
  const pad = ITEM_H * ((rows - 1) / 2);
  return (
    <View style={[styles.wheelRow, { height: ITEM_H * rows }]}>
      <View pointerEvents="none" style={[styles.wheelBand, { top: pad - 1 }]} />
      {children}
      <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0)']} style={[styles.vignetteTop, { height: pad }]} />
      <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']} style={[styles.vignetteBottom, { height: pad }]} />
    </View>
  );
}

const ITEM_H = 40;
const VISIBLE = 5; // odd — one centered row + two on each side
const PAD = ITEM_H * ((VISIBLE - 1) / 2);

const pad2 = (n: number) => String(n).padStart(2, '0');
function haptic() {
  try {
    Haptics.selectionAsync().catch(() => {});
  } catch {}
}

// A single item on the drum — scales/rotates/fades with its distance from the
// centre so the column reads as a rounded 3D wheel.
function WheelItem({ i, scrollY, label, fontSize }: { i: number; scrollY: SharedValue<number>; label: string; fontSize?: number }) {
  const aStyle = useAnimatedStyle(() => {
    const pos = i - scrollY.value / ITEM_H; // 0 when this row is centred
    const abs = Math.abs(pos);
    const rotateX = interpolate(pos, [-2.4, 0, 2.4], [58, 0, -58], Extrapolation.CLAMP);
    const scale = interpolate(abs, [0, 1, 2.4], [1, 0.84, 0.66], Extrapolation.CLAMP);
    const opacity = interpolate(abs, [0, 1, 2.3], [1, 0.5, 0.1], Extrapolation.CLAMP);
    const color = interpolateColor(abs, [0, 0.85], [C.text, C.faint]);
    return { opacity, color, transform: [{ perspective: 520 }, { rotateX: `${rotateX}deg` }, { scale }] };
  });
  return <Animated.Text style={[styles.wheelTxt, fontSize ? { fontSize } : null, aStyle]}>{label}</Animated.Text>;
}

// A scrollable drum column. `index` is the selected row; the parent keeps it in
// sync and the wheel reports back through `onIndex` once it settles. `rows`
// must match the deck's; `fontSize` shrinks long labels (e.g. "1h 30m").
export function Wheel({
  values,
  index,
  onIndex,
  format,
  width,
  rows = VISIBLE,
  fontSize,
}: {
  values: number[];
  index: number;
  onIndex: (i: number) => void;
  format: (v: number) => string;
  width: number;
  rows?: number;
  fontSize?: number;
}) {
  const pad = ITEM_H * ((rows - 1) / 2);
  const scrollY = useSharedValue(index * ITEM_H);
  const lastTick = useSharedValue(index);
  const ref = useRef<ScrollView>(null);
  const selfIndex = useRef(index);

  // Snap to the initial row once laid out.
  useEffect(() => {
    selfIndex.current = index;
    scrollY.value = index * ITEM_H;
    const t = setTimeout(() => ref.current?.scrollTo({ y: index * ITEM_H, animated: false }), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow external changes (e.g. a preset tap) without fighting user scrolls.
  useEffect(() => {
    if (index !== selfIndex.current) {
      selfIndex.current = index;
      ref.current?.scrollTo({ y: index * ITEM_H, animated: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const handler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
      const i = Math.round(e.contentOffset.y / ITEM_H);
      if (i !== lastTick.value) {
        lastTick.value = i;
        runOnJS(haptic)();
      }
    },
  });

  const settle = (y: number) => {
    const i = Math.max(0, Math.min(values.length - 1, Math.round(y / ITEM_H)));
    if (i !== selfIndex.current) {
      selfIndex.current = i;
      onIndex(i);
    }
  };

  return (
    <View style={[styles.wheel, { width, height: ITEM_H * rows }]}>
      <Animated.ScrollView
        ref={ref as any}
        nestedScrollEnabled // a wheel inside a scrolling sheet (Android)
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_H}
        decelerationRate="fast"
        scrollEventThrottle={16}
        onScroll={handler}
        onMomentumScrollEnd={(e: NativeSyntheticEvent<NativeScrollEvent>) => settle(e.nativeEvent.contentOffset.y)}
        onScrollEndDrag={(e: NativeSyntheticEvent<NativeScrollEvent>) => settle(e.nativeEvent.contentOffset.y)}
        contentContainerStyle={{ paddingVertical: pad }}>
        {values.map((v, i) => (
          <WheelItem key={i} i={i} scrollY={scrollY} label={format(v)} fontSize={fontSize} />
        ))}
      </Animated.ScrollView>
    </View>
  );
}

function range(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  for (let v = from; v <= to; v += step) out.push(v);
  return out;
}

// ---- Reusable centered popup ---------------------------------------------
export function CenterPopup({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Popup open={visible} onClose={onClose}>
      <Text style={styles.title}>{title}</Text>
      {children}
      <Tappable onPress={onClose} style={styles.done}>
        <Text style={styles.doneTxt}>Done</Text>
      </Tappable>
    </Popup>
  );
}

// Scope switch + centred preset chips, shared by the time & duration pickers.
function Presets({
  presets,
  tagPresets,
  tagName,
  value,
  format,
  onPick,
}: {
  presets: number[];
  tagPresets: number[];
  tagName: string | null;
  value: number;
  format: (v: number) => string;
  onPick: (v: number) => void;
}) {
  const hasTag = !!tagName && tagPresets.length > 0;
  const [scope, setScope] = useState<'global' | 'tag'>(hasTag ? 'tag' : 'global');
  useEffect(() => {
    setScope(hasTag ? 'tag' : 'global');
  }, [hasTag, tagName]);

  const list = scope === 'tag' ? tagPresets : presets;
  if (presets.length === 0 && tagPresets.length === 0) return null;

  return (
    <>
      {hasTag && (
        <View style={styles.scopeRow}>
          <Tappable onPress={() => setScope('global')} style={[styles.scopeBtn, scope === 'global' && styles.scopeOn]}>
            <Text style={[styles.scopeTxt, { color: scope === 'global' ? '#0b0b0d' : C.textDim }]}>Global</Text>
          </Tappable>
          <Tappable onPress={() => setScope('tag')} style={[styles.scopeBtn, scope === 'tag' && styles.scopeOn]}>
            <Text style={[styles.scopeTxt, { color: scope === 'tag' ? '#0b0b0d' : C.textDim }]} numberOfLines={1}>
              {tagName}
            </Text>
          </Tappable>
        </View>
      )}
      <View style={styles.chipWrap}>
        {list.length === 0 ? (
          <Text style={styles.empty}>No presets in this scope yet.</Text>
        ) : (
          list.map((p, i) => (
            <Tappable key={`${p}-${i}`} onPress={() => onPick(p)} style={[styles.chip, value === p && styles.chipOn]}>
              <Text style={[styles.chipTxt, value === p && styles.chipTxtOn]}>{format(p)}</Text>
            </Tappable>
          ))
        )}
      </View>
    </>
  );
}

// ---- Anchors: pin a task's start / end to another task ---------------------
// A task on the same day (or a day edge) that a start or end can be pinned to.
export type Neighbor = { id: string; title: string; start: number; end: number; color: string };
// "X minutes after `id` ends" (start) or "X minutes before `id` starts" (end).
export type Anchor = { id: string; gap: number };
export const DAY_START_ID = '__daystart';
export const DAY_END_ID = '__dayend';

// Start picker → "After task"; end picker → "Until task".
export type TimeAnchorConfig = {
  kind: 'after' | 'until';
  options: Neighbor[]; // candidate tasks (+ the day edge), in time order
  preferred: string | null; // the nearest one, preselected
  active: Anchor | null; // the pin currently in effect, if any
  start: number; // this task's start and duration (limits + preview)
  dur: number;
  onApply: (a: Anchor, time: number) => void; // time = the new start / end
};

// Duration picker → "In between tasks": start after one, end before another.
export type BetweenConfig = {
  options: Neighbor[]; // the day's tasks with the day edges first / last
  active: { after: Anchor | null; until: Anchor | null };
  onApply: (after: Anchor, until: Anchor, start: number, end: number) => void;
};

const anchorTime = (kind: 'after' | 'until', o: Neighbor, gap: number) => (kind === 'after' ? o.end + gap : o.start - gap);

// ---- Time-of-day drums (hours : minutes [AM/PM]) ---------------------------
export function TimeWheels({
  value,
  clock,
  min = 0,
  max = 24 * 60 - 5,
  onChange,
}: {
  value: number;
  clock: Clock;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
}) {
  const is12 = clock === '12h';
  const h24 = Math.floor(value / 60) % 24;
  const minVal = value % 60;
  const minIdx = Math.round(minVal / 5) % 12;
  const hourIdx = is12 ? (h24 % 12 === 0 ? 11 : (h24 % 12) - 1) : h24;
  const ampmIdx = h24 < 12 ? 0 : 1;

  const hourValues = is12 ? range(1, 12, 1) : range(0, 23, 1);
  const minuteValues = range(0, 55, 5);

  const commit = (hIdx: number, mIdx: number, apIdx: number) => {
    const h = is12 ? ((hIdx + 1) % 12) + (apIdx ? 12 : 0) : hIdx;
    onChange(Math.max(min, Math.min(max, h * 60 + mIdx * 5)));
  };

  return (
    <WheelDeck>
      <Wheel values={hourValues} index={hourIdx} onIndex={(i) => commit(i, minIdx, ampmIdx)} format={(v) => pad2(v)} width={64} />
      <Text style={styles.colon}>:</Text>
      <Wheel values={minuteValues} index={minIdx} onIndex={(i) => commit(hourIdx, i, ampmIdx)} format={(v) => pad2(v)} width={64} />
      {is12 && <Wheel values={[0, 1]} index={ampmIdx} onIndex={(i) => commit(hourIdx, minIdx, i)} format={(v) => (v === 0 ? 'AM' : 'PM')} width={64} />}
    </WheelDeck>
  );
}

// ---- Time-of-day picker (separate hour / minute drums) --------------------
export function TimePickerPopup({
  visible,
  title,
  value,
  presets = [],
  tagPresets = [],
  tagName = null,
  clock,
  min = 0,
  max = 24 * 60 - 5,
  anchor,
  onChange,
  onClose,
}: {
  visible: boolean;
  title: string;
  value: number;
  presets?: number[];
  tagPresets?: number[];
  tagName?: string | null;
  clock: Clock;
  min?: number;
  max?: number;
  anchor?: TimeAnchorConfig; // offer "After task" / "Until task"
  onChange: (v: number) => void;
  onClose: () => void;
}) {
  const [page, setPage] = useState<'time' | 'anchor'>('time');
  useEffect(() => {
    if (visible) setPage('time');
  }, [visible]);

  return (
    <CenterPopup visible={visible} title={title} onClose={onClose}>
      {page === 'time' || !anchor ? (
        <Appear key="time" from="left" distance={14}>
          <TimeWheels value={value} clock={clock} min={min} max={max} onChange={onChange} />
          <Presets presets={presets} tagPresets={tagPresets} tagName={tagName} value={value} format={(v) => fmt(v, clock)} onPick={onChange} />
          {anchor && (
            <>
              <DynHead />
              <AnchorCard cfg={anchor} clock={clock} onPress={() => setPage('anchor')} />
            </>
          )}
        </Appear>
      ) : (
        <Appear key="anchor" from="right" distance={14}>
          <AnchorPage cfg={anchor} clock={clock} onBack={() => setPage('time')} />
        </Appear>
      )}
    </CenterPopup>
  );
}

function DynHead() {
  return (
    <View style={styles.dynHead}>
      <View style={styles.dynLine} />
      <Feather name="zap" size={11} color={C.muted} />
      <Text style={styles.dynLabel}>DYNAMIC</Text>
      <View style={styles.dynLine} />
    </View>
  );
}

// The entry card on the time page: what the pin is (or would be), one tap away.
function AnchorCard({ cfg, clock, onPress }: { cfg: TimeAnchorConfig; clock: Clock; onPress: () => void }) {
  const after = cfg.kind === 'after';
  const on = cfg.active ? cfg.options.find((o) => o.id === cfg.active!.id) ?? null : null;
  const who = on ?? cfg.options.find((o) => o.id === cfg.preferred) ?? null;
  const f = (v: number) => fmt(v, clock);
  let sub = after ? 'Pick a task to start after' : 'Pick a task to end before';
  if (who) {
    const t = after ? `ends ${f(who.end)}` : `starts ${f(who.start)}`;
    sub = on ? `${who.title} · ${cfg.active!.gap ? `${fmtDur(cfg.active!.gap)} ${after ? 'after' : 'before'}` : after ? 'right after' : 'right before'}` : `${who.title} · ${t}`;
  }
  return (
    <Appear delay={60} from="up">
      <Tappable onPress={onPress} style={[styles.anchorCard, !!on && styles.anchorCardOn]}>
        <View style={styles.anchorIcon}>
          <Feather name={after ? 'skip-back' : 'skip-forward'} size={15} color={C.accentB} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.anchorLabel}>{after ? 'After task' : 'Until task'}</Text>
          <View style={styles.dynWhoRow}>
            {who && <View style={[styles.dynWhoDot, { backgroundColor: who.color }]} />}
            <Text style={styles.anchorSub} numberOfLines={1}>
              {sub}
            </Text>
          </View>
        </View>
        {on ? <Feather name="check-circle" size={17} color={C.accentB} /> : <Feather name="chevron-right" size={18} color={C.muted} />}
      </Tappable>
    </Appear>
  );
}

// Choose the task, then the gap; every change applies live (like a preset).
function AnchorPage({ cfg, clock, onBack }: { cfg: TimeAnchorConfig; clock: Clock; onBack: () => void }) {
  const after = cfg.kind === 'after';
  const opts = cfg.options.filter((o) => (after ? true : o.start - cfg.start >= 5));
  const initial = (cfg.active && opts.some((o) => o.id === cfg.active!.id) ? cfg.active.id : null) ?? (opts.some((o) => o.id === cfg.preferred) ? cfg.preferred : null) ?? opts[0]?.id ?? null;
  const [sel, setSel] = useState<string | null>(initial);
  const [gap, setGap] = useState(cfg.active && cfg.active.id === initial ? cfg.active.gap : 0);
  const a = opts.find((o) => o.id === sel) ?? null;
  const maxGap = !a ? 0 : after ? 180 : Math.max(0, Math.min(180, Math.floor((a.start - cfg.start - 5) / 5) * 5));
  const g = Math.min(gap, maxGap);

  const apply = (o: Neighbor | null, x: number) => {
    if (o) cfg.onApply({ id: o.id, gap: x }, anchorTime(cfg.kind, o, x));
  };
  // Opening the page applies the (pre)selected task at once.
  useEffect(() => {
    apply(a, g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const f = (v: number) => fmt(v, clock);
  const s = a ? (after ? a.end + g : cfg.start) : cfg.start;
  const e = a ? (after ? s + cfg.dur : a.start - g) : cfg.start + cfg.dur;

  // Bring the preselected chip into view (the list is in time order).
  const chips = useRef<ScrollView>(null);
  const scrolled = useRef(false);
  const onChipLayout = (id: string, x: number) => {
    if (!scrolled.current && id === sel) {
      scrolled.current = true;
      chips.current?.scrollTo({ x: Math.max(0, x - 44), animated: false });
    }
  };

  return (
    <>
      <View style={styles.dynPageHead}>
        <Tappable onPress={onBack} hitSlop={8} style={styles.dynBack}>
          <Feather name="chevron-left" size={18} color={C.textDim} />
        </Tappable>
        <Text style={styles.dynTitle}>{after ? 'Start after a task' : 'End before a task'}</Text>
      </View>
      {opts.length === 0 ? (
        <Text style={styles.empty}>No task starts after this one on this day.</Text>
      ) : (
        <>
          <ScrollView ref={chips} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.anchorChips} style={styles.anchorChipsBox}>
            {opts.map((o, i) => {
              const on = o.id === sel;
              const edge = o.id === DAY_START_ID || o.id === DAY_END_ID;
              return (
                <View key={o.id} onLayout={(ev) => onChipLayout(o.id, ev.nativeEvent.layout.x)}>
                <Appear delay={30 + i * 26} from="right" distance={10}>
                  <Tappable
                    onPress={() => {
                      setSel(o.id);
                      const mg = after ? 180 : Math.max(0, Math.min(180, Math.floor((o.start - cfg.start - 5) / 5) * 5));
                      const x = Math.min(gap, mg);
                      setGap(x);
                      apply(o, x);
                    }}
                    style={[styles.anchorChip, on && styles.anchorChipOn]}>
                    {edge ? <Feather name={o.id === DAY_START_ID ? 'sunrise' : 'sunset'} size={12} color={on ? '#0b0b0d' : C.muted} /> : <View style={[styles.dynWhoDot, { backgroundColor: o.color }]} />}
                    <View>
                      <Text style={[styles.anchorChipTxt, on && { color: '#0b0b0d' }]} numberOfLines={1}>
                        {o.title}
                      </Text>
                      <Text style={[styles.anchorChipTime, on && { color: 'rgba(11,11,13,0.7)' }]}>{after ? f(o.end) : f(o.start)}</Text>
                    </View>
                  </Tappable>
                </Appear>
                </View>
              );
            })}
          </ScrollView>
          <WheelDeck>
            <Wheel
              key={sel ?? 'none'}
              values={range(0, maxGap, 5)}
              index={Math.round(g / 5)}
              onIndex={(i) => {
                setGap(i * 5);
                apply(a, i * 5);
              }}
              format={(v) => String(v)}
              width={70}
            />
            <Text style={styles.unit}>{after ? 'min after' : 'min before'}</Text>
          </WheelDeck>
          {a && <PinDiagram kind={cfg.kind} anchor={a} gap={g} s={s} e={e} clock={clock} />}
        </>
      )}
      <Tappable onPress={onBack} style={styles.backRow}>
        <Feather name="chevron-left" size={16} color={C.textDim} />
        <Text style={styles.backTxt}>Back to time</Text>
      </Tappable>
    </>
  );
}

// ---- Duration picker (hours / minutes drums + "in between tasks") ---------
export function DurationPickerPopup({
  visible,
  value,
  presets = [],
  tagPresets = [],
  tagName = null,
  clock = '24h',
  between,
  onChange,
  onClose,
}: {
  visible: boolean;
  value: number;
  presets?: number[];
  tagPresets?: number[];
  tagName?: string | null;
  clock?: Clock;
  between?: BetweenConfig; // offer "In between tasks"
  onChange: (v: number) => void;
  onClose: () => void;
}) {
  const [page, setPage] = useState<'dur' | 'between'>('dur');
  useEffect(() => {
    if (visible) setPage('dur');
  }, [visible]);

  const h = Math.min(12, Math.floor(value / 60));
  const m = value % 60;
  const minIdx = Math.round(m / 5) % 12;
  const hourValues = range(0, 12, 1);
  const minuteValues = range(0, 55, 5);
  const commit = (hIdx: number, mIdx: number) => onChange(Math.max(5, hIdx * 60 + mIdx * 5));

  const pair = between ? [between.active.after, between.active.until].map((x) => (x ? between.options.find((o) => o.id === x.id) ?? null : null)) : [null, null];

  return (
    <CenterPopup visible={visible} title="Duration" onClose={onClose}>
      {page === 'dur' || !between ? (
        <Appear key="dur" from="left" distance={14}>
          <WheelDeck>
            <Wheel values={hourValues} index={h} onIndex={(i) => commit(i, minIdx)} format={(v) => String(v)} width={56} />
            <Text style={styles.unit}>h</Text>
            <Wheel values={minuteValues} index={minIdx} onIndex={(i) => commit(h, i)} format={(v) => pad2(v)} width={56} />
            <Text style={styles.unit}>m</Text>
          </WheelDeck>
          <Presets presets={presets} tagPresets={tagPresets} tagName={tagName} value={value} format={fmtDur} onPick={onChange} />
          {between && (
            <>
              <DynHead />
              <Appear delay={60} from="up">
                <Tappable onPress={() => setPage('between')} style={[styles.anchorCard, !!(pair[0] && pair[1]) && styles.anchorCardOn]}>
                  <View style={styles.anchorIcon}>
                    <Feather name="minimize-2" size={15} color={C.accentB} style={{ transform: [{ rotate: '45deg' }] }} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.anchorLabel}>In between tasks</Text>
                    <Text style={styles.anchorSub} numberOfLines={1}>
                      {pair[0] && pair[1] ? `${pair[0].title}  →  ${pair[1].title}` : 'Fill the time between two tasks'}
                    </Text>
                  </View>
                  {pair[0] && pair[1] ? <Feather name="check-circle" size={17} color={C.accentB} /> : <Feather name="chevron-right" size={18} color={C.muted} />}
                </Tappable>
              </Appear>
            </>
          )}
        </Appear>
      ) : (
        <Appear key="between" from="right" distance={14}>
          <BetweenPage cfg={between} clock={clock} onBack={() => setPage('dur')} />
        </Appear>
      )}
    </CenterPopup>
  );
}

// Pick the task to start after, then the one to end before; the task then
// fills exactly the time between them (applied as soon as both are chosen).
function BetweenPage({ cfg, clock, onBack }: { cfg: BetweenConfig; clock: Clock; onBack: () => void }) {
  const find = (id: string | undefined | null) => (id ? cfg.options.find((o) => o.id === id) ?? null : null);
  const [aId, setA] = useState<string | null>(find(cfg.active.after?.id)?.id ?? null);
  const [bId, setB] = useState<string | null>(find(cfg.active.until?.id)?.id ?? null);
  const [slot, setSlot] = useState<'after' | 'until'>(aId && !bId ? 'until' : 'after');
  const A = find(aId);
  const B = find(bId);
  const f = (v: number) => fmt(v, clock);

  const validUntil = (o: Neighbor, from: Neighbor | null) => !!from && o.id !== DAY_START_ID && o.start - from.end >= 5;
  const validAfter = (o: Neighbor) => o.id !== DAY_END_ID;

  const pick = (o: Neighbor) => {
    if (slot === 'after') {
      if (!validAfter(o)) return;
      setA(o.id);
      const keepB = B && validUntil(B, o);
      if (!keepB) setB(null);
      if (keepB && B) cfg.onApply({ id: o.id, gap: 0 }, { id: B.id, gap: 0 }, o.end, B.start);
      setSlot(keepB ? 'after' : 'until');
    } else {
      if (!validUntil(o, A) || !A) return;
      setB(o.id);
      cfg.onApply({ id: A.id, gap: 0 }, { id: o.id, gap: 0 }, A.end, o.start);
    }
  };

  // After choosing where to start, bring the tasks you can end before into view
  // (they come right after it); an existing pair opens scrolled to itself.
  const listRef = useRef<ScrollView>(null);
  const rowY = useRef<Record<string, number>>({});
  const scrollToRow = (id: string | null, animated: boolean) => {
    const y = id ? rowY.current[id] : undefined;
    if (y != null) listRef.current?.scrollTo({ y: Math.max(0, y - 6), animated });
  };
  useEffect(() => {
    if (slot === 'until' && aId) scrollToRow(aId, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot, aId]);
  const onRowLayout = (id: string, y: number) => {
    const first = rowY.current[id] == null;
    rowY.current[id] = y;
    if (first && id === aId) scrollToRow(aId, false);
  };

  const done = A && B;
  return (
    <>
      <View style={styles.dynPageHead}>
        <Tappable onPress={onBack} hitSlop={8} style={styles.dynBack}>
          <Feather name="chevron-left" size={18} color={C.textDim} />
        </Tappable>
        <Text style={styles.dynTitle}>Between two tasks</Text>
      </View>

      <View style={styles.slotRow}>
        <Tappable onPress={() => setSlot('after')} style={[styles.slotPill, slot === 'after' && styles.slotPillOn]}>
          <Text style={styles.slotKind}>AFTER</Text>
          <Text style={[styles.slotName, !A && { color: C.faint }]} numberOfLines={1}>
            {A ? A.title : 'Choose'}
          </Text>
        </Tappable>
        <Feather name="arrow-right" size={15} color={C.faint} />
        <Tappable onPress={() => A && setSlot('until')} style={[styles.slotPill, slot === 'until' && styles.slotPillOn, !A && { opacity: 0.45 }]}>
          <Text style={styles.slotKind}>UNTIL</Text>
          <Text style={[styles.slotName, !B && { color: C.faint }]} numberOfLines={1}>
            {B ? B.title : 'Choose'}
          </Text>
        </Tappable>
      </View>

      <ScrollView ref={listRef} style={styles.betweenList} showsVerticalScrollIndicator={false}>
        {cfg.options.map((o, i) => {
          const edge = o.id === DAY_START_ID || o.id === DAY_END_ID;
          const ok = slot === 'after' ? validAfter(o) : validUntil(o, A);
          const isA = o.id === aId;
          const isB = o.id === bId;
          return (
            <View key={o.id} onLayout={(ev) => onRowLayout(o.id, ev.nativeEvent.layout.y)}>
            <Appear delay={20 + i * 22} from="up" distance={8}>
              <Tappable onPress={() => pick(o)} disabled={!ok} style={[styles.betweenRow, (isA || isB) && styles.betweenRowOn, !ok && !isA && !isB && { opacity: 0.35 }]}>
                {edge ? (
                  <Feather name={o.id === DAY_START_ID ? 'sunrise' : 'sunset'} size={14} color={C.muted} />
                ) : (
                  <View style={[styles.betweenRail, { backgroundColor: o.color }]} />
                )}
                <Text style={styles.betweenName} numberOfLines={1}>
                  {o.title}
                </Text>
                <Text style={styles.betweenTime}>{edge ? f(o.start) : `${f(o.start)} – ${f(o.end)}`}</Text>
                {(isA || isB) && (
                  <View style={styles.betweenBadge}>
                    <Text style={styles.betweenBadgeTxt}>{isA ? 'AFTER' : 'UNTIL'}</Text>
                  </View>
                )}
              </Tappable>
            </Appear>
            </View>
          );
        })}
      </ScrollView>

      <View style={[styles.betweenResult, done && styles.betweenResultOn]}>
        {done ? (
          <>
            <Feather name="check" size={15} color={C.accentB} />
            <Text style={styles.betweenResultTxt}>
              {f(A!.end)} – {f(B!.start)} · {fmtDur(B!.start - A!.end)}
            </Text>
          </>
        ) : (
          <Text style={styles.betweenHint}>{slot === 'after' || !A ? 'Tap the task to start after' : `Now tap the task to end before`}</Text>
        )}
      </View>

      <Tappable onPress={onBack} style={styles.backRow}>
        <Feather name="chevron-left" size={16} color={C.textDim} />
        <Text style={styles.backTxt}>Back to duration</Text>
      </Tappable>
    </>
  );
}

// A small vertical schematic of a pin: anchor ▸ gap ▸ this task (or the
// reverse for "until"). The gap stretches with the chosen minutes.
function PinDiagram({ kind, anchor, gap, s, e, clock }: { kind: 'after' | 'until'; anchor: Neighbor; gap: number; s: number; e: number; clock: Clock }) {
  const f = (v: number) => fmt(v, clock);
  const gapH = useSharedValue(16);
  useEffect(() => {
    gapH.value = withSpring(16 + Math.min(1, gap / 120) * 22, sp({ damping: 16, stiffness: 220 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gap]);
  const gapStyle = useAnimatedStyle(() => ({ height: gapH.value }));
  const edge = anchor.id === DAY_START_ID || anchor.id === DAY_END_ID;
  const after = kind === 'after';

  const anchorRow = (
    <View style={styles.diaRow}>
      <View style={[styles.diaRail, { backgroundColor: edge ? C.faint : anchor.color }]} />
      <Text style={styles.diaName} numberOfLines={1}>
        {anchor.title}
      </Text>
      <Text style={styles.diaTime}>{edge ? f(anchor.start) : after ? `ends ${f(anchor.end)}` : `starts ${f(anchor.start)}`}</Text>
    </View>
  );
  const self = (
    <View style={[styles.diaRow, styles.diaSelf]}>
      <View style={[styles.diaRail, { backgroundColor: C.accentB }]} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.diaName, { color: C.text }]}>This task</Text>
        <Text style={styles.diaSub}>{fmtDur(Math.max(0, e - s))}</Text>
      </View>
      <Text style={[styles.diaTime, { color: C.text }]}>
        {f(s)} – {f(e)}
      </Text>
    </View>
  );
  const gapRow = (
    <Animated.View style={[styles.diaGap, gapStyle]}>
      <Svg width={7} height="100%">
        <SvgLine x1={3.5} y1={2} x2={3.5} y2="100%" stroke="rgba(255,255,255,0.3)" strokeWidth={1.5} strokeDasharray="2.5 3" strokeLinecap="round" />
      </Svg>
      <Text style={styles.diaGapTxt}>{gap === 0 ? (after ? 'right after' : 'right before') : `${fmtDur(gap)} gap`}</Text>
    </Animated.View>
  );
  return (
    <View style={styles.dia}>
      {after ? (
        <>
          {anchorRow}
          {gapRow}
          {self}
        </>
      ) : (
        <>
          {self}
          {gapRow}
          {anchorRow}
        </>
      )}
    </View>
  );
}

// ---- Single-select list popup (tags / places) -----------------------------
export type SelectOption = { id: string; label: string; sub?: string };
export function SelectPopup({
  visible,
  title,
  options,
  selectedId,
  emptyText,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: SelectOption[];
  selectedId: string | null;
  emptyText?: string;
  onSelect: (id: string | null) => void;
  onClose: () => void;
}) {
  return (
    <CenterPopup visible={visible} title={title} onClose={onClose}>
      {options.length === 0 ? (
        <Text style={styles.empty}>{emptyText || 'Nothing here yet — add some in Settings.'}</Text>
      ) : (
        <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
          <Tappable onPress={() => onSelect(null)} style={[styles.row, selectedId == null && styles.rowOn]}>
            <Text style={[styles.rowTxt, { color: C.muted }]}>None</Text>
            {selectedId == null && <Text style={styles.check}>✓</Text>}
          </Tappable>
          {options.map((o) => {
            const on = o.id === selectedId;
            return (
              <Tappable key={o.id} onPress={() => onSelect(o.id)} style={[styles.row, on && styles.rowOn]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTxt}>{o.label}</Text>
                  {!!o.sub && <Text style={styles.rowSub}>{o.sub}</Text>}
                </View>
                {on && <Text style={styles.check}>✓</Text>}
              </Tappable>
            );
          })}
        </ScrollView>
      )}
    </CenterPopup>
  );
}

// ---- Month calendar (reused by the date picker and the repeat end-date) ----
export function MonthCalendar({
  value,
  weekStart,
  onChange,
}: {
  value: string;
  weekStart: 'mon' | 'sun';
  onChange: (key: string) => void;
}) {
  const base = dateFromKey(value);
  const [view, setView] = useState({ y: base.getFullYear(), m: base.getMonth() });
  useEffect(() => {
    setView({ y: base.getFullYear(), m: base.getMonth() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const first = new Date(view.y, view.m, 1);
  const startDow = weekStart === 'mon' ? (first.getDay() + 6) % 7 : first.getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const shift = (delta: number) => {
    let m = view.m + delta;
    let y = view.y;
    if (m < 0) {
      m = 11;
      y--;
    }
    if (m > 11) {
      m = 0;
      y++;
    }
    setView({ y, m });
  };

  const tKey = todayKey();
  return (
    <>
      <View style={styles.calHead}>
        <Tappable onPress={() => shift(-1)} hitSlop={10} style={styles.calArrow}>
          <Text style={styles.calArrowTxt}>‹</Text>
        </Tappable>
        <Text style={styles.calMonth}>
          {MONTHS[view.m]} {view.y}
        </Text>
        <View style={styles.calHeadRight}>
          <Tappable onPress={() => onChange(tKey)} style={styles.todayBtn}>
            <Text style={styles.todayBtnTxt}>Today</Text>
          </Tappable>
          <Tappable onPress={() => shift(1)} hitSlop={10} style={styles.calArrow}>
            <Text style={styles.calArrowTxt}>›</Text>
          </Tappable>
        </View>
      </View>
      <View style={styles.calRow}>
        {weekdayLetters(weekStart).map((l, i) => (
          <Text key={i} style={styles.calDow}>
            {l}
          </Text>
        ))}
      </View>
      <View style={styles.calGrid}>
        {cells.map((d, i) => {
          if (d == null) return <View key={i} style={styles.calCell} />;
          const key = dateKey(new Date(view.y, view.m, d));
          const on = key === value;
          const isToday = key === tKey;
          return (
            <Tappable key={i} style={styles.calCell} onPress={() => onChange(key)}>
              <View style={[styles.calDay, on && styles.calDayOn, !on && isToday && styles.calDayToday]}>
                <Text style={[styles.calDayTxt, on && styles.calDayTxtOn, !on && isToday && styles.calDayTodayTxt]}>{d}</Text>
              </View>
            </Tappable>
          );
        })}
      </View>
    </>
  );
}

// ---- Month calendar date picker ------------------------------------------
export function DatePickerPopup({
  visible,
  value,
  weekStart,
  onChange,
  onClose,
}: {
  visible: boolean;
  value: string; // YYYY-MM-DD
  weekStart: 'mon' | 'sun';
  onChange: (key: string) => void;
  onClose: () => void;
}) {
  return (
    <CenterPopup visible={visible} title="Date" onClose={onClose}>
      <MonthCalendar value={value} weekStart={weekStart} onChange={onChange} />
    </CenterPopup>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 17, fontWeight: '700', color: C.text, marginBottom: 14 },
  done: { height: 48, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  doneTxt: { fontSize: 15, fontWeight: '700', color: C.text },
  section: { fontSize: 11, color: C.muted, fontWeight: '600', marginTop: 16, marginBottom: 9 },

  // Wheel
  wheelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    height: ITEM_H * VISIBLE,
    backgroundColor: 'rgba(255,255,255,0.035)',
    borderRadius: 18,
    overflow: 'hidden',
    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06), inset 0 14px 20px -12px rgba(0,0,0,0.85), inset 0 -14px 20px -12px rgba(0,0,0,0.85)',
    position: 'relative',
  },
  vignetteTop: { position: 'absolute', left: 0, right: 0, top: 0, height: PAD },
  vignetteBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, height: PAD },
  wheelBand: {
    position: 'absolute',
    left: 10,
    right: 10,
    top: PAD - 1,
    height: ITEM_H + 2,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.09)',
    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08), 0 2px 10px -4px rgba(0,0,0,0.5)',
  },
  wheel: { overflow: 'hidden' },
  wheelTxt: { height: ITEM_H, lineHeight: ITEM_H, textAlign: 'center', fontSize: 23, fontWeight: '700', fontVariant: ['tabular-nums'] },
  colon: { fontSize: 23, fontWeight: '800', color: C.text, marginHorizontal: 1 },
  unit: { fontSize: 15, fontWeight: '700', color: C.muted, marginHorizontal: 2 },

  // Presets
  scopeRow: { flexDirection: 'row', gap: 6, marginTop: 16, marginBottom: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: 4 },
  scopeBtn: { flex: 1, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  scopeOn: { backgroundColor: C.accentB },
  scopeTxt: { fontSize: 13, fontWeight: '700' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 14 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)' },
  chipOn: { backgroundColor: C.accentB },
  chipTxt: { fontSize: 13, fontWeight: '700', color: C.textDim, fontVariant: ['tabular-nums'] },
  chipTxtOn: { color: '#0b0b0d' },
  empty: { color: C.faint, fontSize: 13, paddingVertical: 8, textAlign: 'center', width: '100%' },
  // Dynamic duration options
  dynHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 20, marginBottom: 10 },
  dynLine: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.07)' },
  dynLabel: { fontSize: 11, color: C.muted, fontWeight: '700', letterSpacing: 0.5 },
  dynWhoRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  dynWhoDot: { width: 7, height: 7, borderRadius: 4 },
  // "After task" / "Until task" / "In between" entry cards (same base; the
  // "On" state has a matching transparent-free shadow so it never sticks)
  anchorCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 11, backgroundColor: 'rgba(79,209,197,0.07)', boxShadow: 'inset 0 0 0 1px rgba(79,209,197,0.2)' },
  anchorCardOn: { backgroundColor: 'rgba(79,209,197,0.14)', boxShadow: 'inset 0 0 0 1.5px rgba(79,209,197,0.55)' },
  anchorIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(79,209,197,0.14)', alignItems: 'center', justifyContent: 'center' },
  anchorLabel: { fontSize: 14, fontWeight: '800', color: C.accentB },
  anchorSub: { flexShrink: 1, fontSize: 12.5, fontWeight: '600', color: C.textDim },
  anchorChipsBox: { marginHorizontal: -20, marginBottom: 12, flexGrow: 0 },
  anchorChips: { gap: 8, paddingHorizontal: 20 },
  anchorChip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', maxWidth: 190 },
  anchorChipOn: { backgroundColor: C.accentB },
  anchorChipTxt: { fontSize: 13, fontWeight: '700', color: C.text, maxWidth: 140 },
  anchorChipTime: { fontSize: 11, fontWeight: '600', color: C.muted, fontVariant: ['tabular-nums'] },
  slotRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  slotPill: { flex: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: 'rgba(255,255,255,0.05)', boxShadow: 'inset 0 0 0 1.5px rgba(79,209,197,0)' },
  slotPillOn: { backgroundColor: 'rgba(79,209,197,0.1)', boxShadow: 'inset 0 0 0 1.5px rgba(79,209,197,0.6)' },
  slotKind: { fontSize: 10, fontWeight: '800', color: C.accentB, letterSpacing: 0.6 },
  slotName: { fontSize: 13.5, fontWeight: '700', color: C.text, marginTop: 2 },
  betweenList: { maxHeight: 250 },
  betweenRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 10, borderRadius: 12, marginBottom: 4 },
  betweenRowOn: { backgroundColor: 'rgba(79,209,197,0.12)' },
  betweenRail: { width: 4, height: 18, borderRadius: 2 },
  betweenName: { flex: 1, fontSize: 14, fontWeight: '600', color: C.text },
  betweenTime: { fontSize: 12, fontWeight: '600', color: C.muted, fontVariant: ['tabular-nums'] },
  betweenBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: C.accentB },
  betweenBadgeTxt: { fontSize: 9.5, fontWeight: '800', color: '#0b0b0d', letterSpacing: 0.4 },
  betweenResult: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 10, paddingVertical: 11, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)' },
  betweenResultOn: { backgroundColor: 'rgba(79,209,197,0.12)' },
  betweenResultTxt: { fontSize: 14, fontWeight: '800', color: C.text, fontVariant: ['tabular-nums'] },
  betweenHint: { fontSize: 12.5, fontWeight: '600', color: C.muted },
  dynPageHead: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 12, marginLeft: -6 },
  dynBack: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  dynTitle: { fontSize: 14.5, fontWeight: '700', color: C.text },
  dynHint: { fontSize: 12, color: C.muted, textAlign: 'center', marginTop: 12, lineHeight: 17 },
  dia: { marginTop: 14, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.035)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.05)' },
  diaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 30 },
  diaSelf: { paddingVertical: 4 },
  diaRail: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  diaName: { flex: 1, fontSize: 13, fontWeight: '700', color: C.textDim },
  diaSub: { fontSize: 11.5, fontWeight: '600', color: C.muted, marginTop: 1, fontVariant: ['tabular-nums'] },
  diaTime: { fontSize: 12.5, fontWeight: '700', color: C.muted, fontVariant: ['tabular-nums'] },
  diaGap: { flexDirection: 'row', alignItems: 'center', gap: 10, overflow: 'hidden' },
  diaGapTxt: { fontSize: 11.5, fontWeight: '600', color: C.muted },
  backRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 12, paddingVertical: 6 },
  backTxt: { fontSize: 13.5, fontWeight: '600', color: C.textDim },

  // Select list
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 14, borderRadius: 12, marginBottom: 4 },
  rowOn: { backgroundColor: 'rgba(79,209,197,0.14)' },
  rowTxt: { fontSize: 15, fontWeight: '600', color: C.text },
  rowSub: { fontSize: 12, color: C.muted, marginTop: 2 },
  check: { fontSize: 16, fontWeight: '700', color: C.accentB },

  // Calendar
  calHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  calHeadRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  calArrow: { width: 40, height: 40, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
  calArrowTxt: { fontSize: 22, color: C.textDim, marginTop: -2 },
  calMonth: { fontSize: 15, fontWeight: '700', color: C.text },
  todayBtn: { paddingHorizontal: 12, height: 34, borderRadius: 10, backgroundColor: 'rgba(79,209,197,0.14)', alignItems: 'center', justifyContent: 'center' },
  todayBtnTxt: { fontSize: 12.5, fontWeight: '700', color: C.accentB },
  calRow: { flexDirection: 'row' },
  calDow: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600', color: C.muted, marginBottom: 4 },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', padding: 2 },
  calDay: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  calDayOn: { backgroundColor: C.accentB, borderRadius: 12 },
  calDayToday: { borderWidth: 1.5, borderColor: C.accentB, borderRadius: 12 },
  calDayTxt: { fontSize: 14, fontWeight: '600', color: C.text },
  calDayTxtOn: { color: '#0b0b0d', fontWeight: '700' },
  calDayTodayTxt: { color: C.accentB, fontWeight: '700' },
});
