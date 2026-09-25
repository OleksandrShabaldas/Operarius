import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '../theme';
import { ms, sp } from '../motion';
import { Task, TaskType } from '../types';
import { useApp } from '../store';
import { addDays, headerParts, hexA, todayKey } from '../utils';
import { expandForDay } from '../recurrence';
import { buildDragRuler, cardHeight, computeDayLayout, DragRuler, resolvePushApart } from '../layout';
import { DayDot, WeekStrip } from '../components/WeekStrip';
import { DraggedCard, Timeline } from '../components/Timeline';
import { DayState } from '../components/TaskCard';
import { RollingText } from '../components/RollingText';
import { MonthView } from '../components/MonthView';
import { Tappable } from '../components/anim';
import { StarMark } from '../components/StarToggle';

type Props = {
  selectedKey: string;
  setSelectedKey: (key: string) => void;
  onOpenStats: () => void;
  onOpenSettings: () => void;
  onNewTask: (opts?: { startMin?: number; dur?: number; type?: TaskType }) => void;
  onOpenInfo: (id: string) => void;
  todayPing: number; // bumps when the Today tab is tapped while already open
};

type Source = 'tap' | 'swipe' | 'week' | 'today';

function useNowMinute(): number {
  const [m, setM] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });
  useEffect(() => {
    const t = setInterval(() => {
      const d = new Date();
      setM(d.getHours() * 60 + d.getMinutes());
    }, 30000);
    return () => clearInterval(t);
  }, []);
  return m;
}

const EDGE = 84; // auto-scroll zone at the top/bottom of the timeline while dragging
const MAX_SPEED = 13; // px per frame at the very edge

// Everything about the card being held, built once when it's picked up.
type DragCtx = { id: string; task: Task; others: Task[]; ruler: DragRuler; baseY: number };

// Where the held card will actually land for a finger time: exactly there
// (overlap allowed), or beside whatever it hits (Push apart). Putting it back
// at its own time is always a no-op.
function landing(c: DragCtx, min: number, pushApart: boolean): number {
  if (min === c.task.start || !pushApart) return min;
  return resolvePushApart(min, c.task.dur, c.others);
}

export function TodayScreen({ selectedKey, setSelectedKey, onOpenStats, onOpenSettings, onNewTask, onOpenInfo, todayPing }: Props) {
  const insets = useSafeAreaInsets();
  const { tasks, settings, tasksForDay, toggleDone, toggleSubtask, toggleExpanded, moveTask } = useApp();
  const nowMin = useNowMinute();
  const [viewportH, setViewportH] = useState(560);
  const [headerH, setHeaderH] = useState(0);
  const [alldayH, setAlldayH] = useState(0);

  const dayTasks = useMemo(() => tasksForDay(selectedKey), [tasksForDay, selectedKey]);
  const planned = useMemo(() => dayTasks.filter((t) => t.type === 'planned'), [dayTasks]);
  // All-day chips: starred (high priority) first.
  const allday = useMemo(() => dayTasks.filter((t) => t.type === 'allday').sort((a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0)), [dayTasks]);
  const { dayNum, weekday, month } = headerParts(selectedKey);
  const today = todayKey();
  const isToday = selectedKey === today;
  const dayState: DayState = selectedKey < today ? 'past' : selectedKey > today ? 'future' : 'today';

  // ---- Day-change transitions -------------------------------------------
  // Direction is derived in render so the header roll and the content slide
  // agree on the frame the change happens. Paging the week strip only fades
  // the content (the strip itself does the moving); other changes slide it.
  const sourceRef = useRef<Source>('tap');
  const prevKeyRef = useRef(selectedKey);
  const dirRef = useRef(1);
  if (selectedKey !== prevKeyRef.current) dirRef.current = selectedKey > prevKeyRef.current ? 1 : -1;
  const dir = dirRef.current;
  const contentX = useSharedValue(0);
  const contentO = useSharedValue(1);
  const contentStyle = useAnimatedStyle(() => ({ opacity: contentO.value, transform: [{ translateX: contentX.value }] }));
  useEffect(() => {
    if (selectedKey === prevKeyRef.current) return;
    prevKeyRef.current = selectedKey;
    if (sourceRef.current === 'week') {
      contentO.value = 0.2;
      contentO.value = withTiming(1, { duration: ms(260) });
    } else {
      contentX.value = dir * 26;
      contentX.value = withSpring(0, sp({ damping: 20, stiffness: 190 }));
      contentO.value = 0.35;
      contentO.value = withTiming(1, { duration: ms(240) });
    }
    sourceRef.current = 'tap';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);
  const go = useCallback((key: string, source: Source) => {
    sourceRef.current = source;
    setSelectedKey(key);
  }, [setSelectedKey]);
  const changeDay = (delta: number) => go(addDays(selectedKey, delta), 'swipe');
  const onSelectDay = useCallback((key: string) => go(key, 'tap'), [go]);
  const onPageWeek = useCallback((delta: number) => go(addDays(selectedKey, delta * 7), 'week'), [go, selectedKey]);
  const daySwipe = Gesture.Pan()
    .activeOffsetX([-24, 24])
    .failOffsetY([-18, 18])
    .onEnd((e) => {
      'worklet';
      if (e.translationX > 55 || e.velocityX > 600) runOnJS(changeDay)(-1);
      else if (e.translationX < -55 || e.velocityX < -600) runOnJS(changeDay)(1);
    });

  // ---- Week-strip dots: one per task, coloured, hollow until completed ----
  const dotsFor = useCallback(
    (key: string): DayDot[] => {
      const tagMap = new Map(settings.tags.map((t) => [t.id, t]));
      const hidden = (tagId: string | null) => {
        if (!tagId) return false;
        const t = tagMap.get(tagId);
        if (!t) return false;
        if (t.hideDots) return true;
        const p = t.parentId ? tagMap.get(t.parentId) : undefined;
        return !!p?.hideDots;
      };
      return expandForDay(tasks, key)
        .filter((t) => !hidden(t.tagId))
        .sort((a, b) => (a.type === 'allday' ? 0 : 1) - (b.type === 'allday' ? 0 : 1) || a.start - b.start)
        .map((t) => ({ color: t.color, done: t.done }));
    },
    [tasks, settings.tags]
  );

  // ---- Layout + dragging --------------------------------------------------
  // While a card is held, the day is drawn as it WILL look with the card landed
  // at the current time: room opens for it, overlaps fuse with their band, the
  // card is shown collapsed. So what you see while dragging is exactly the
  // result — nothing collapses on lift or stretches on drop. The finger maps to
  // a time through the drag ruler built for that preview (see layout.ts).
  const fullLayout = useMemo(
    () => computeDayLayout(planned, settings.dayStart, settings.dayEnd, settings.gapThreshold),
    [planned, settings.dayStart, settings.dayEnd, settings.gapThreshold]
  );
  const [drag, setDrag] = useState<{ id: string; min: number } | null>(null);
  const ctxRef = useRef<DragCtx | null>(null);
  const ctx = drag && ctxRef.current && ctxRef.current.id === drag.id ? ctxRef.current : null;

  let layout = fullLayout;
  let dragged: DraggedCard | null = null;
  if (drag && ctx) {
    const land = landing(ctx, drag.min, settings.swapOnDrag);
    layout = ctx.ruler.layoutAt(land);
    const slot = layout.pos[ctx.id] ?? { top: ctx.baseY, h: cardHeight(ctx.task) };
    dragged = { task: ctx.task, h: slot.h, baseY: ctx.baseY, liveStart: land, slot };
  }

  // A light tap the moment the held card's landing starts overlapping a task
  // (it then fuses into that task's stack on screen).
  const dragOver = !!dragged && !!(dragged.slot.joinTop || dragged.slot.joinBottom);
  const overRef = useRef(false);
  useEffect(() => {
    if (dragOver && !overRef.current) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    overRef.current = dragOver;
  }, [dragOver]);

  // Latest values for the (stable) drag callbacks.
  const live = useRef({ layout, planned, settings, viewportH });
  live.current = { layout, planned, settings, viewportH };

  const scrollRef = useRef<any>(null);
  const viewportRef = useRef<View>(null);
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  const dragRef = useRef<{ id: string; min: number } | null>(null);
  const dyRef = useRef(0);
  const fingerRef = useRef(0);
  const scrollAtStart = useRef(0);
  const viewRect = useRef({ top: 0, bottom: 0 });
  const raf = useRef<number | null>(null);

  const recompute = useCallback((scrollOverride?: number) => {
    const d = dragRef.current;
    const c = ctxRef.current;
    const { settings: S } = live.current;
    if (!d || !c) return;
    const sy = scrollOverride ?? scrollY.value;
    const y = c.baseY + dyRef.current + (sy - scrollAtStart.current);
    let m = Math.round(c.ruler.minOf(y) / 5) * 5;
    m = Math.max(c.ruler.lo, Math.min(c.ruler.hi, m));
    if (m !== d.min) {
      dragRef.current = { id: d.id, min: m };
      setDrag(dragRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tick = useCallback(() => {
    if (!dragRef.current) {
      raf.current = null;
      return;
    }
    const fy = fingerRef.current;
    const { top, bottom } = viewRect.current;
    let v = 0;
    if (bottom > top) {
      if (fy < top + EDGE) v = -MAX_SPEED * Math.min(1, (top + EDGE - fy) / EDGE);
      else if (fy > bottom - EDGE) v = MAX_SPEED * Math.min(1, (fy - (bottom - EDGE)) / EDGE);
    }
    if (v !== 0) {
      const { layout: L, viewportH: vh } = live.current;
      const maxY = Math.max(0, Math.max(L.H + 100, vh) + 4 - vh);
      const cur = scrollY.value;
      const next = Math.max(0, Math.min(maxY, cur + v));
      if (Math.abs(next - cur) > 0.5) {
        scrollRef.current?.scrollTo({ y: next, animated: false });
        recompute(next);
      }
    }
    raf.current = requestAnimationFrame(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDragStart = useCallback((id: string) => {
    const { planned: P, settings: S } = live.current;
    const t = P.find((x) => x.id === id);
    if (!t) return;
    // Held cards are shown collapsed (subtasks folded) to stay compact.
    const task = { ...t, expanded: false };
    const others = P.filter((x) => x.id !== id);
    const ruler = buildDragRuler(task, others, S.dayStart, S.dayEnd, S.gapThreshold);
    ctxRef.current = { id, task, others, ruler, baseY: ruler.yOf(t.start) };
    dragRef.current = { id, min: t.start };
    dyRef.current = 0;
    scrollAtStart.current = scrollY.value;
    setDrag(dragRef.current);
    viewportRef.current?.measureInWindow((_x, y, _w, h) => {
      viewRect.current = { top: y, bottom: y + h };
      fingerRef.current = y + h / 2;
    });
    if (raf.current == null) raf.current = requestAnimationFrame(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDragMove = useCallback((id: string, dy: number, absY: number) => {
    if (!dragRef.current || dragRef.current.id !== id) return;
    dyRef.current = dy;
    fingerRef.current = absY;
    recompute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDragEnd = useCallback(
    (id: string) => {
      const d = dragRef.current;
      dragRef.current = null;
      if (raf.current != null) {
        cancelAnimationFrame(raf.current);
        raf.current = null;
      }
      const c = ctxRef.current;
      if (d && c && d.id === id) {
        const land = landing(c, d.min, live.current.settings.swapOnDrag);
        if (land !== c.task.start) moveTask(id, land);
      }
      setDrag(null);
      ctxRef.current = null;
    },
    [moveTask]
  );

  useEffect(
    () => () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
    },
    []
  );

  // ---- Scrolling to "now" ---------------------------------------------------
  const didScroll = useRef(false);
  const wantNow = useRef(false);
  useEffect(() => {
    if (isToday && !didScroll.current) {
      didScroll.current = true;
      const y = Math.max(0, layout.yAt(nowMin) - 180);
      setTimeout(() => scrollRef.current?.scrollTo({ y, animated: false }), 60);
    }
    if (isToday && wantNow.current) {
      wantNow.current = false;
      const y = Math.max(0, layout.yAt(nowMin) - viewportH * 0.32);
      setTimeout(() => scrollRef.current?.scrollTo({ y, animated: true }), 80);
    }
  });

  // ---- "Today" button (shown whenever another day is open) ----------------
  // ---- Month view (tap the big date) -----------------------------------------
  const [monthOpen, setMonthOpen] = useState(false);
  const [monthTop, setMonthTop] = useState(0);
  const chev = useSharedValue(0);
  useEffect(() => {
    chev.value = withSpring(monthOpen ? 1 : 0, sp({ damping: 16, stiffness: 240 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthOpen]);
  const chevStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${chev.value * 180}deg` }] }));
  const closeMonth = useCallback(() => setMonthOpen(false), []);
  const pickFromMonth = useCallback(
    (key: string) => {
      setMonthOpen(false);
      if (key !== selectedKey) go(key, 'tap');
    },
    [go, selectedKey]
  );

  const todayVis = useSharedValue(isToday ? 0 : 1);
  const showToday = !isToday && !monthOpen;
  useEffect(() => {
    todayVis.value = withSpring(showToday ? 1 : 0, sp({ damping: 18, stiffness: 230 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showToday]);
  const todayStyle = useAnimatedStyle(() => ({
    opacity: todayVis.value,
    transform: [{ translateY: (1 - todayVis.value) * -12 }, { scale: 0.86 + 0.14 * todayVis.value }],
  }));
  const goToday = () => {
    if (isToday) {
      // Already on today: just bring "now" into view.
      scrollRef.current?.scrollTo({ y: Math.max(0, layout.yAt(nowMin) - viewportH * 0.32), animated: true });
      return;
    }
    wantNow.current = true;
    go(today, 'today');
  };
  const pingRef = useRef(todayPing);
  useEffect(() => {
    if (todayPing !== pingRef.current) {
      pingRef.current = todayPing;
      goToday();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayPing]);

  return (
    // collapsable={false}: keep this view in the native tree so the floating
    // pill's zIndex stays scoped to the Today screen (a flattened parent would
    // let it compete with — and draw over — Settings and Insights).
    <View style={styles.root} collapsable={false}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]} onLayout={(e) => setHeaderH(e.nativeEvent.layout.height)}>
        <View style={styles.headerRow} onLayout={(e) => setMonthTop(e.nativeEvent.layout.y + e.nativeEvent.layout.height + 8)}>
          {/* Tap the date for the month view. */}
          <Tappable onPress={() => setMonthOpen((o) => !o)} scaleTo={0.97} dimTo={0.85} hitSlop={6} style={styles.dateRow}>
            <RollingText text={String(dayNum)} dir={dir} height={44} align="right" textStyle={styles.dayNum} />
            <RollingText text={weekday} dir={dir} height={28} textStyle={styles.weekday} style={styles.weekdayBox} />
            <RollingText text={month} dir={dir} height={20} textStyle={styles.month} style={styles.monthBox} />
            <Animated.View style={[styles.monthChev, chevStyle]}>
              <Feather name="chevron-down" size={15} color={C.muted} />
            </Animated.View>
          </Tappable>
          <View style={styles.headBtns}>
            <Tappable style={styles.headBtn} onPress={onOpenStats} hitSlop={6}>
              <Feather name="bar-chart-2" size={17} color={C.textDim} />
            </Tappable>
            <Tappable style={styles.headBtn} onPress={onOpenSettings} hitSlop={6}>
              <Feather name="menu" size={17} color={C.textDim} />
            </Tappable>
          </View>
        </View>

        <WeekStrip
          selectedKey={selectedKey}
          weekStart={settings.weekStart}
          dotsFor={dotsFor}
          onSelect={onSelectDay}
          onPageWeek={onPageWeek}
        />
      </View>

      <GestureDetector gesture={daySwipe}>
        <Animated.View style={[styles.slide, contentStyle]}>
          {/* All-day tasks (shown only when the day has any) */}
          {allday.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.alldayScroll}
              contentContainerStyle={styles.alldayRow}
              onLayout={(e) => setAlldayH(e.nativeEvent.layout.height)}>
              {allday.map((t) => (
                <Tappable key={t.id} style={styles.alldayCard} onPress={() => onOpenInfo(t.id)}>
                  <LinearGradient colors={[t.color, hexA(t.color, 0.72)]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={styles.alldayIcon}>
                    <Text style={styles.alldayEmoji}>{t.emoji}</Text>
                  </LinearGradient>
                  {!!t.starred && <StarMark size={12} style={{ marginRight: -3 }} />}
                  <Text style={[styles.alldayTitle, t.done && styles.strike]} numberOfLines={1}>
                    {t.title}
                  </Text>
                </Tappable>
              ))}
              <Tappable style={styles.alldayAdd} onPress={() => onNewTask({ type: 'allday' })}>
                <Feather name="plus" size={16} color={C.muted} />
                <Text style={styles.alldayAddTxt}>All-day</Text>
              </Tappable>
            </ScrollView>
          )}

          <View ref={viewportRef} collapsable={false} style={styles.scroll}>
            <Animated.ScrollView
              ref={scrollRef}
              style={styles.scroll}
              onScroll={onScroll}
              scrollEventThrottle={16}
              onLayout={(e) => setViewportH(e.nativeEvent.layout.height)}
              contentContainerStyle={{ paddingTop: 4 }}
              showsVerticalScrollIndicator={false}>
              <Timeline
                layout={layout}
                dayKey={selectedKey}
                dragged={dragged}
                scrollY={scrollY}
                tags={settings.tags}
                places={settings.places}
                clock={settings.clock}
                dayStart={settings.dayStart}
                dayEnd={settings.dayEnd}
                viewportH={viewportH}
                nowMin={isToday ? nowMin : null}
                dayState={dayState}
                onDragStart={onDragStart}
                onDragMove={onDragMove}
                onDragEnd={onDragEnd}
                onOpen={onOpenInfo}
                onToggle={toggleDone}
                onToggleSubtask={toggleSubtask}
                onToggleExpanded={toggleExpanded}
                onAddAt={(startMin, dur) => onNewTask({ startMin, dur, type: 'planned' })}
              />
            </Animated.ScrollView>
          </View>
        </Animated.View>
      </GestureDetector>

      {/* Back-to-today pill, floating just under the week strip */}
      <Animated.View pointerEvents={showToday ? 'box-none' : 'none'} style={[styles.todayWrap, { top: headerH + (allday.length > 0 ? alldayH : 0) + 6 }, todayStyle]}>
        <Tappable onPress={goToday} style={styles.todayPill} hitSlop={8}>
          {selectedKey > today && <Feather name="chevron-left" size={15} color={C.accentB} />}
          <Feather name="calendar" size={13} color={C.accentB} />
          <Text style={styles.todayTxt}>Today</Text>
          {selectedKey < today && <Feather name="chevron-right" size={15} color={C.accentB} />}
        </Tappable>
      </Animated.View>

      {/* Month view, dropping down from under the date (above everything here). */}
      <View pointerEvents="box-none" style={styles.monthLayer}>
        <MonthView open={monthOpen} top={monthTop} selectedKey={selectedKey} weekStart={settings.weekStart} dotsFor={dotsFor} onPick={pickFromMonth} onClose={closeMonth} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  slide: { flex: 1 },
  header: { paddingHorizontal: 22, paddingBottom: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  // Baselines are matched by hand: each rolling text is a fixed-height box.
  dateRow: { flexDirection: 'row', alignItems: 'flex-end' },
  dayNum: { fontSize: 38, fontWeight: '700', letterSpacing: -1, color: C.text, fontVariant: ['tabular-nums'] },
  weekday: { fontSize: 22, fontWeight: '600', color: '#e8e8ec' },
  month: { fontSize: 15, fontWeight: '500', color: '#7a7a82' },
  weekdayBox: { marginLeft: 9, marginBottom: 3 },
  monthBox: { marginLeft: 9, marginBottom: 5 },
  monthChev: { marginLeft: 4, marginBottom: 7 },
  monthLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 40 },
  headBtns: { flexDirection: 'row', gap: 10 },
  headBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  alldayScroll: { maxHeight: 56, flexGrow: 0 },
  alldayRow: { paddingHorizontal: 20, paddingVertical: 6, gap: 8, alignItems: 'center' },
  alldayCard: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.card, borderRadius: 12, paddingLeft: 6, paddingRight: 12, paddingVertical: 6, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)' },
  alldayIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  alldayEmoji: { fontSize: 15 },
  alldayTitle: { fontSize: 13.5, fontWeight: '600', color: C.text, maxWidth: 150 },
  strike: { textDecorationLine: 'line-through', color: '#6a6a72' },
  alldayAdd: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: 'rgba(255,255,255,0.04)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)' },
  alldayAddTxt: { fontSize: 13, fontWeight: '600', color: C.muted },
  scroll: { flex: 1 },
  todayWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 20 },
  todayPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(22,23,27,0.94)',
    boxShadow: 'inset 0 0 0 1px rgba(79,209,197,0.35), 0 10px 26px -8px rgba(0,0,0,0.85), 0 0 18px -6px rgba(79,209,197,0.45)',
  },
  todayTxt: { fontSize: 13.5, fontWeight: '700', color: C.accentB },
});
