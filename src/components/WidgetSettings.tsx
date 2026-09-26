import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, SharedValue, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import * as W from '../../modules/widgets';
import type { WidgetKind, WidgetStatus } from '../../modules/widgets';
import { ms } from '../motion';
import { C, MONTHS, WEEKDAYS_FULL } from '../theme';
import { useApp } from '../store';
import { Clock, Settings, Task } from '../types';
import { addDays, dateKey, findTag, fmt, fmtDur, hexA, placeLabel, tagLabel, todayKey } from '../utils';
import { expandRange, railColor, widgetOrder, widgetTimeline, WRow } from '../widgets';
import { Appear, Tappable } from './anim';
import { Hatch } from './Hatch';
import { STAR } from './StarToggle';

type Icon = keyof typeof Feather.glyphMap;

// ---------------------------------------------------------------------------
// Settings → Widgets: the three widgets previewed with your own tasks (drawn
// the way the home-screen ones are), and a way to put them on the home screen.
// ---------------------------------------------------------------------------
export function WidgetSettings() {
  const { tasks, settings } = useApp();
  const [status, setStatus] = useState<WidgetStatus>({ today: 0, month: 0, combo: 0, canPin: false });
  const [asked, setAsked] = useState<WidgetKind | null>(null);

  const load = useCallback(() => {
    W.status().then(setStatus);
  }, []);
  useEffect(() => {
    load();
    // Back from the launcher's "Add widget" dialog (or the home screen).
    const sub = AppState.addEventListener('change', (s) => s === 'active' && load());
    return () => sub.remove();
  }, [load]);

  const add = async (kind: WidgetKind) => {
    Haptics.selectionAsync().catch(() => {});
    const ok = await W.pin(kind);
    setAsked(ok ? kind : null);
    if (!ok) setStatus((s) => ({ ...s, canPin: false }));
    setTimeout(load, 1500);
  };

  return (
    <View style={{ marginTop: 10 }}>
      {!W.available && (
        <Appear from="up" delay={20} style={styles.note}>
          <Feather name="smartphone" size={14} color={C.muted} />
          <Text style={styles.noteTxt}>Widgets live on your Android home screen — here’s how they’ll look with your tasks.</Text>
        </Appear>
      )}

      <Text style={[styles.section, { marginTop: W.available ? 6 : 20 }]}>TODAY</Text>
      <Appear from="up" delay={40}>
        <TodayPreview tasks={tasks} settings={settings} />
      </Appear>
      <AddRow kind="today" count={status.today} canPin={status.canPin} asked={asked === 'today'} onAdd={() => add('today')} delay={90} />

      <Text style={styles.section}>MONTH</Text>
      <Appear from="up" delay={120}>
        <MonthPreview tasks={tasks} settings={settings} />
      </Appear>
      <AddRow kind="month" count={status.month} canPin={status.canPin} asked={asked === 'month'} onAdd={() => add('month')} delay={170} />

      <View style={styles.sectionRow}>
        <Text style={[styles.section, styles.sectionInRow]}>TODAY & MONTH</Text>
        <Appear from="pop" delay={260} style={styles.newPill}>
          <Text style={styles.newTxt}>NEW</Text>
        </Appear>
      </View>
      <Appear from="up" delay={200}>
        <ComboPreview tasks={tasks} settings={settings} />
      </Appear>
      <AddRow kind="combo" count={status.combo} canPin={status.canPin} asked={asked === 'combo'} onAdd={() => add('combo')} delay={250} />

      <Text style={styles.section}>HOW THEY WORK</Text>
      <Appear from="up" delay={60} style={styles.card}>
        <Tip icon="clock" text="Today is a timeline from the now line on: tasks drop off once they’re over, and free time shows until your next one. Tap a task to open it, free time to plan something there, + to add a task." />
        <Tip icon="star" text="The month shows up to three tasks a day — starred first, then all-day ones, then by time. Tap a day to open it; the arrows change the month." />
        <Tip icon="toggle-right" text="Today & Month is both in one: tap Today or Month at its top to switch between them." />
        <Tip icon="refresh-cw" text="They update as you plan, and keep going on their own for a week even if you don’t open the app." last />
      </Appear>
      {W.available && !status.canPin && (
        <Appear from="up" style={styles.note}>
          <Feather name="info" size={14} color={C.muted} />
          <Text style={styles.noteTxt}>To add one: touch and hold an empty spot on your home screen, pick Widgets, then find Operarius.</Text>
        </Appear>
      )}
    </View>
  );
}

const KIND_NAME: Record<WidgetKind, string> = { today: 'Today', month: 'Month', combo: 'Today & Month' };

function AddRow({ kind, count, canPin, asked, onAdd, delay }: { kind: WidgetKind; count: number; canPin: boolean; asked: boolean; onAdd: () => void; delay: number }) {
  return (
    <Appear from="up" delay={delay} style={styles.addRow}>
      {count > 0 ? (
        <Appear key="on" from="pop" style={styles.onBadge}>
          <Feather name="check" size={12} color={C.accentB} />
          <Text style={styles.onBadgeTxt}>{count > 1 ? `${count} on your home screen` : 'On your home screen'}</Text>
        </Appear>
      ) : asked ? (
        <Appear key="asked" from="pop" style={styles.onBadge}>
          <Feather name="smartphone" size={12} color={C.accentB} />
          <Text style={styles.onBadgeTxt}>Confirm on your home screen</Text>
        </Appear>
      ) : (
        <View style={{ flex: 1 }} />
      )}
      {W.available && canPin && (
        <Tappable onPress={onAdd} style={styles.addBtn}>
          <Feather name="plus" size={15} color={C.accentA} />
          <Text style={styles.addBtnTxt}>{count > 0 ? 'Add another' : `Add ${KIND_NAME[kind]}`}</Text>
        </Tappable>
      )}
    </Appear>
  );
}

function Tip({ icon, text, last }: { icon: Icon; text: string; last?: boolean }) {
  return (
    <View style={[styles.tip, !last && styles.tipLine]}>
      <Feather name={icon} size={14} color={C.accentB} style={{ marginTop: 1 }} />
      <Text style={styles.tipTxt}>{text}</Text>
    </View>
  );
}

// ---- The widgets' look --------------------------------------------------------

const G = 42; // the timeline's gutter (times), as on the widget
const BAND = 30; // a card's colour band; the rail runs down its middle
const RAIL_X = G + BAND / 2;
const SURFACE = '#131317'; // the widget's surface, mid-gradient (what hatching fades into)
const RAIL_TILE = require('../../assets/widget-rail.png');

function WidgetCard({ children, style }: { children: React.ReactNode; style?: object }) {
  return (
    <LinearGradient colors={['#17171C', '#0E0E11']} style={[styles.widget, style]}>
      {children}
    </LinearGradient>
  );
}

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

// Today's and tomorrow's tasks (repeating ones included).
function useDays(tasks: Task[]) {
  const key = todayKey();
  const next = addDays(key, 1);
  const byDay = useMemo(() => expandRange(tasks, key, next), [tasks, key, next]);
  return { list: byDay.get(key) ?? [], tomorrow: byDay.get(next) ?? [] };
}

// ---- Today ------------------------------------------------------------------

function TodayPreview({ tasks, settings }: { tasks: Task[]; settings: Settings }) {
  const now = useNowMinute();
  const { list, tomorrow } = useDays(tasks);
  const d = new Date();
  return (
    <WidgetCard>
      <View style={styles.tHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.tDay}>{WEEKDAYS_FULL[d.getDay()]}</Text>
          <Text style={styles.tDate}>
            {MONTHS[d.getMonth()]} {d.getDate()}
          </Text>
        </View>
        <DayCount list={list} />
        <PlusBtn size={36} />
      </View>
      <TodayBody list={list} tomorrow={tomorrow} settings={settings} now={now} maxH={330} />
    </WidgetCard>
  );
}

function DayCount({ list }: { list: Task[] }) {
  if (!list.length) return null;
  const done = list.filter((t) => t.done).length;
  const all = done === list.length;
  return <Text style={[styles.tCount, all && { color: C.accentB }]}>{all ? 'All done' : `${done} of ${list.length}`}</Text>;
}

function PlusBtn({ size }: { size: number }) {
  return (
    <LinearGradient colors={[C.accentA, C.accentB]} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={[styles.tAdd, { width: size, height: size, borderRadius: size / 2 }]}>
      <Feather name="plus" size={17} color="#0b0b0d" />
    </LinearGradient>
  );
}

// A row's height on the widget (dp), to show as many as its list would before scrolling.
function rowHeight(r: WRow, s: Settings): number {
  switch (r.kind) {
    case 'now':
      return 22;
    case 'card':
      return (hasMeta(r.t, s) ? 72 : 56) + 6;
    case 'gap':
      return r.type === 'rail' ? 8 : r.type === 'chip' ? 26 : 56;
    case 'overlap':
      return 28;
    case 'edge':
      return 38;
    case 'note':
      return r.allDone ? 84 : 58;
    case 'next':
      return 56;
  }
}

const hasMeta = (t: Task, s: Settings) => !!findTag(s.tags, t.tagId) || !!placeLabel(s.places, t.placeId) || t.subtasks.length > 0;

function rowKey(r: WRow, i: number, rows: WRow[]): string {
  switch (r.kind) {
    case 'card':
      return `c-${r.t.id}`;
    case 'gap': {
      const next = rows[i + 1];
      return `g-${next ? rowKey(next, i + 1, rows) : 'end'}`;
    }
    case 'edge':
      return r.end ? 'end' : 'begin';
    case 'overlap':
      return `o-${i}`;
    default:
      return r.kind;
  }
}

function TodayBody({ list, tomorrow, settings, now, maxH }: { list: Task[]; tomorrow: Task[]; settings: Settings; now: number; maxH: number }) {
  const { dayStart, dayEnd, gapThreshold, clock } = settings;
  const rows = useMemo(() => widgetTimeline(list, tomorrow, now, { dayStart, dayEnd, gapThreshold }), [list, tomorrow, now, dayStart, dayEnd, gapThreshold]);
  const allDay = list.filter((t) => t.type === 'allday').sort((a, b) => Number(!!b.starred) - Number(!!a.starred));
  const done = list.filter((t) => t.done).length;
  // As many rows as the widget's list shows before it's scrolled.
  const shown: WRow[] = [];
  let h = 0;
  for (const r of rows) {
    const rh = rowHeight(r, settings);
    if (shown.length && h + rh > maxH) break;
    shown.push(r);
    h += rh;
  }
  const cut = shown.length < rows.length;
  return (
    <>
      <View style={[styles.tBar, !list.length && { opacity: 0 }]}>
        <LinearGradient colors={[C.accentA, C.accentB]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.tBarFill, { width: `${list.length ? Math.round((done / list.length) * 100) : 0}%` }]} />
      </View>
      {allDay.length > 0 && (
        <Appear from="up" delay={60} style={styles.tAllDay}>
          <Feather name="sun" size={13} color={STAR} />
          <Text style={styles.tAllDayTxt} numberOfLines={1}>
            {allDay.map((t, i) => (
              <Text key={t.id}>
                {i > 0 && <Text style={{ color: C.faint }}>{'  ·  '}</Text>}
                <Text style={t.done ? [styles.strike, { color: '#6E6E76' }] : null}>
                  {t.starred ? '★ ' : ''}
                  {t.title}
                </Text>
              </Text>
            ))}
          </Text>
        </Appear>
      )}
      <View style={[styles.tList, { maxHeight: maxH }]}>
        {shown.map((r, i) => (
          <Appear key={rowKey(r, i, shown)} from="up" delay={80 + i * 45} distance={8}>
            <TimelineRow r={r} clock={clock} s={settings} now={now} />
          </Appear>
        ))}
        {cut && <LinearGradient pointerEvents="none" colors={[hexA(SURFACE, 0), SURFACE]} style={styles.cutFade} />}
      </View>
    </>
  );
}

function TimelineRow({ r, clock, s, now }: { r: WRow; clock: Clock; s: Settings; now: number }) {
  switch (r.kind) {
    case 'now':
      return (
        <View style={styles.nowRow}>
          <NowMark now={now} clock={clock} />
        </View>
      );
    case 'card':
      return <CardRow r={r} clock={clock} s={s} now={now} />;
    case 'gap':
      return <GapRow r={r} clock={clock} />;
    case 'overlap':
      return (
        <View style={[styles.row, { height: 28 }]}>
          <View style={{ width: G }} />
          <RedBlock>
            <View style={styles.ovPill}>
              <Feather name="alert-triangle" size={9} color={C.now} />
              <Text style={styles.ovTxt}>
                {r.full ? 'Fully overlapping' : 'Overlapping'} · {fmtDur(r.min)}
              </Text>
            </View>
          </RedBlock>
        </View>
      );
    case 'edge':
      return (
        <View style={[styles.row, { height: 38 }]}>
          <View style={{ width: G }} />
          <RedBlock>
            <Text style={styles.edgeTxt}>
              {r.end ? 'END OF DAY' : 'BEGINNING OF DAY'} · {fmt(r.min, clock)}
            </Text>
          </RedBlock>
        </View>
      );
    case 'note':
      return (
        <View style={styles.noteRow}>
          {r.allDone && (
            <View style={styles.noteIcon}>
              <Feather name="check" size={13} color="#0b0b0d" />
            </View>
          )}
          <Text style={[styles.noteTitle, r.allDone && { color: C.accentB }]}>{r.title}</Text>
          <Text style={styles.noteSub}>{r.sub}</Text>
        </View>
      );
    case 'next':
      return (
        <View style={styles.nextRow}>
          <Text style={styles.nextGut}>{r.t.type === 'allday' ? '' : fmt(r.t.start, clock).replace(' ', '\n')}</Text>
          <View style={styles.nextCard}>
            <View style={[styles.nextTile, { backgroundColor: hexA(r.t.color, 0.33) }]}>
              <Text style={styles.nextEmoji}>{r.t.emoji}</Text>
            </View>
            <View style={{ flex: 1, marginLeft: 9 }}>
              <Text style={styles.nextWhen}>{r.t.type === 'allday' ? 'TOMORROW · ALL DAY' : 'TOMORROW'}</Text>
              <Text numberOfLines={1} style={styles.nextTitle}>
                {r.t.starred ? '★ ' : ''}
                {r.t.title}
              </Text>
            </View>
            {r.more > 0 && <Text style={styles.nextMore}>+{r.more}</Text>}
          </View>
        </View>
      );
  }
}

// The now line: its time in the gutter (hours:minutes — no room for AM/PM), a dot on the rail.
function NowMark({ now, clock, style }: { now: number; clock: Clock; style?: object }) {
  return (
    <View pointerEvents="none" style={[styles.nowMark, style]}>
      <View style={styles.nowLine} />
      <View style={styles.nowClockBox}>
        <Text style={styles.nowClock}>{fmt(now, clock).split(' ')[0]}</Text>
      </View>
      <View style={styles.nowDot} />
    </View>
  );
}

function CardRow({ r, clock, s, now }: { r: Extract<WRow, { kind: 'card' }>; clock: Clock; s: Settings; now: number }) {
  const t = r.t;
  const tag = findTag(s.tags, t.tagId);
  const place = placeLabel(s.places, t.placeId);
  const subs = t.subtasks.length ? `${t.subtasks.filter((x) => x.done).length}/${t.subtasks.length} subtasks` : '';
  const meta = !!tag || !!place || !!subs;
  const H = meta ? 72 : 56;
  const y = r.line != null ? Math.min(H - 4, Math.max(4, r.line * H)) : null;
  const [time, ap] = fmt(t.start, clock).split(' ');
  const tagColor = t.done ? C.muted : (tag?.color ?? C.muted);
  return (
    <View style={styles.cardWrap}>
      <View style={[styles.cardRow, { height: H }]}>
        <View style={styles.gut}>
          {!(y != null && y < (clock === '24h' ? 28 : 40)) && (
            <>
              <Text style={[styles.gutTxt, { color: r.running && y == null ? C.now : t.done ? C.faint : C.muted }]}>{time}</Text>
              {!!ap && <Text style={styles.gutAp}>{ap}</Text>}
            </>
          )}
        </View>
        <View style={styles.tlCard}>
          <View style={[styles.band, { backgroundColor: railColor(t) }]}>
            {y != null && <View style={[styles.bandPast, { height: y, backgroundColor: grey(railColor(t)) }]} />}
            <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.3)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            <Text style={styles.bandEmoji}>{t.emoji}</Text>
          </View>
          <View style={styles.cardBody}>
            <Text numberOfLines={1} style={[styles.cTitle, t.done && styles.cTitleDone]}>
              {!!t.starred && <Text style={{ color: t.done ? '#6A6A72' : STAR }}>★ </Text>}
              {t.title}
            </Text>
            <Text numberOfLines={1} style={styles.cTime}>
              {fmt(t.start, clock)} – {fmt(t.start + t.dur, clock)}
              <Text style={{ color: C.faint }}> · {fmtDur(t.dur)}</Text>
            </Text>
            {meta && (
              <View style={styles.cMeta}>
                {!!tag && (
                  <Text numberOfLines={1} style={[styles.cTag, { color: tagColor, backgroundColor: hexA(tagColor, 0.15) }]}>
                    {tagLabel(tag)}
                  </Text>
                )}
                {!!place && (
                  <View style={styles.cPlace}>
                    <Feather name="map-pin" size={9} color={C.muted} />
                    <Text numberOfLines={1} style={styles.cPlaceTxt}>
                      {place}
                    </Text>
                  </View>
                )}
                {!!subs && (
                  <Text numberOfLines={1} style={styles.cSubs}>
                    {subs}
                  </Text>
                )}
              </View>
            )}
          </View>
          <View style={[styles.check, t.done && { backgroundColor: t.color, borderColor: 'transparent' }]}>{t.done && <Feather name="check" size={11} color="#0b0b0d" />}</View>
        </View>
      </View>
      {y != null && (
        <>
          <View pointerEvents="none" style={[styles.elapsed, { height: y }]} />
          <NowMark now={now} clock={clock} style={{ position: 'absolute', left: 0, right: 0, top: 3 + y - 9 }} />
        </>
      )}
    </View>
  );
}

function GapRow({ r, clock }: { r: Extract<WRow, { kind: 'gap' }>; clock: Clock }) {
  const H = r.type === 'rail' ? 8 : r.type === 'chip' ? 26 : 56;
  const len = r.to - r.from;
  const live = r.live && r.inside;
  const label = live ? `Free until ${fmt(r.to, clock)}` : r.type === 'free' ? `${fmtDur(len)} free` : r.inside ? `${len} min` : fmtDur(len);
  return (
    <View style={[styles.row, { height: H }]}>
      <View style={{ width: G }} />
      <View style={styles.railCol}>
        <RailHalf color={r.above} />
        <RailHalf color={r.below} />
      </View>
      {r.type === 'chip' && (
        <View style={styles.chipWrap}>
          <View style={styles.chip}>
            <Text style={[styles.chipTxt, live && styles.liveTxt]}>{label}</Text>
          </View>
        </View>
      )}
      {r.type === 'free' && (
        <Hatch color="#ffffff" opacity={0.05} radius={12} fade={SURFACE} fadeSize={10} style={styles.free}>
          <Text style={[styles.freeLabel, live && styles.liveTxt]}>{label}</Text>
          <Text style={styles.freeAdd}>＋ Create a task</Text>
        </Hatch>
      )}
    </View>
  );
}

// A colour without its colour (same lightness): the band behind the now line, as the app shows it.
function grey(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const l = Math.round(0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255));
  return `rgb(${l},${l},${l})`;
}

// Half of the dotted rail, in the colour of the task on its side (faint where there's none).
function RailHalf({ color }: { color: string | null }) {
  return <Image source={RAIL_TILE} resizeMode="repeat" style={[styles.railHalf, { tintColor: color ?? '#ffffff', opacity: color ? 0.62 : 0.16 }]} />;
}

function RedBlock({ children }: { children: React.ReactNode }) {
  return (
    <Hatch color="#ff5a64" opacity={0.16} radius={12} fade={SURFACE} fadeSize={6} style={styles.redBlock}>
      {children}
    </Hatch>
  );
}

// ---- Month ------------------------------------------------------------------

function useMonthNav() {
  const [off, setOff] = useState(0);
  const go = (n: number) => {
    Haptics.selectionAsync().catch(() => {});
    setOff((o) => Math.max(-24, Math.min(24, o + n)));
  };
  return { off, setOff, go };
}

function monthOf(off: number) {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth() + off, 1);
}

function MonthTitle({ off, style }: { off: number; style?: object }) {
  const first = monthOf(off);
  return (
    <Appear key={`t${off}`} from={off >= 0 ? 'right' : 'left'} distance={10} style={[styles.mTitle, style]}>
      <Text style={styles.mMonth}>{MONTHS[first.getMonth()]}</Text>
      <Text style={styles.mYear}>{first.getFullYear()}</Text>
    </Appear>
  );
}

function MonthNav({ off, go, reset }: { off: number; go: (n: number) => void; reset: () => void }) {
  return (
    <>
      {off !== 0 && (
        <Appear from="pop">
          <Tappable onPress={reset} style={styles.mToday}>
            <Text style={styles.mTodayTxt}>Today</Text>
          </Tappable>
        </Appear>
      )}
      <Tappable onPress={() => go(-1)} style={styles.mArrow} hitSlop={6}>
        <Feather name="chevron-left" size={16} color={C.textDim} />
      </Tappable>
      <Tappable onPress={() => go(1)} style={styles.mArrow} hitSlop={6}>
        <Feather name="chevron-right" size={16} color={C.textDim} />
      </Tappable>
    </>
  );
}

function monthRows(off: number, monFirst: boolean) {
  const first = monthOf(off);
  const lead = monFirst ? (first.getDay() + 6) % 7 : first.getDay();
  const daysIn = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return Math.ceil((lead + daysIn) / 7);
}

// The weekdays and the grid; `rowH`: a week's height (how many task lines fit a day, as on the widget).
function MonthGrid({ tasks, settings, off, rowH }: { tasks: Task[]; settings: Settings; off: number; rowH: number }) {
  const today = new Date();
  const first = monthOf(off);
  const monFirst = settings.weekStart === 'mon';
  const lead = monFirst ? (first.getDay() + 6) % 7 : first.getDay();
  const rows = monthRows(off, monFirst);
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - lead);
  const from = dateKey(start);
  const to = dateKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + rows * 7 - 1));
  const byDay = useMemo(() => expandRange(tasks, from, to), [tasks, from, to]);
  const tKey = todayKey();
  const letters = monFirst ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'] : ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const todayCol = monFirst ? (today.getDay() + 6) % 7 : today.getDay();
  // Task lines that fit a day (the widget's own sums): all of them, or with a "+N" line.
  const fitAll = Math.max(0, Math.min(3, Math.floor((rowH - 2 - 20) / 14.2)));
  const fitMore = Math.max(0, Math.min(3, Math.floor((rowH - 2 - 20 - 10.5) / 14.2)));
  return (
    <>
      <View style={styles.mWeek}>
        {letters.map((l, i) => (
          <Text key={i} style={[styles.mLetter, off === 0 && i === todayCol && { color: C.accentB }]}>
            {l}
          </Text>
        ))}
      </View>
      <Appear key={`g${off}`} from={off >= 0 ? 'right' : 'left'} distance={14}>
        {Array.from({ length: rows }, (_, r) => (
          <View key={r} style={[styles.mRow, { height: rowH }]}>
            {Array.from({ length: 7 }, (_, c) => {
              const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + r * 7 + c);
              const k = dateKey(d);
              const inMonth = d.getMonth() === first.getMonth();
              const isToday = k === tKey;
              const past = k < tKey;
              const list = (byDay.get(k) ?? []).slice().sort(widgetOrder);
              const n = list.length > fitAll ? Math.min(fitMore, list.length) : list.length;
              const rest = list.length - n;
              return (
                <View key={c} style={[styles.mCell, isToday && styles.mCellToday]}>
                  <View style={[styles.mNum, isToday && styles.mNumToday]}>
                    <Text style={[styles.mNumTxt, isToday ? { color: '#0b0b0d' } : !inMonth ? { color: '#3E3E45' } : past ? { color: '#7A7A82' } : null]}>{d.getDate()}</Text>
                  </View>
                  {list.slice(0, n).map((t) => {
                    const strong = inMonth && !t.done && !past;
                    return (
                      <View key={t.id} style={[styles.mChip, { backgroundColor: hexA(t.color, strong ? 0.44 : inMonth ? 0.22 : 0.13) }]}>
                        <Text style={[styles.mChipTxt, !strong && { color: '#9A9AA2' }, t.done && styles.strike]} numberOfLines={1}>
                          {t.title}
                        </Text>
                      </View>
                    );
                  })}
                  {rest > 0 && <Text style={styles.mMore}>{n === 0 ? rest : `+${rest}`}</Text>}
                </View>
              );
            })}
          </View>
        ))}
      </Appear>
    </>
  );
}

function MonthPreview({ tasks, settings }: { tasks: Task[]; settings: Settings }) {
  const { off, setOff, go } = useMonthNav();
  return (
    <WidgetCard style={{ paddingHorizontal: 10 }}>
      <View style={styles.mHead}>
        <MonthTitle off={off} />
        <MonthNav off={off} go={go} reset={() => setOff(0)} />
      </View>
      <MonthGrid tasks={tasks} settings={settings} off={off} rowH={70} />
    </WidgetCard>
  );
}

// ---- Today & Month ------------------------------------------------------------

const SEG_W = 70; // one side of the switch
const COMBO_H = 340; // the body under the switch (the widget is about square)
const EASE = Easing.bezier(0.4, 0, 0.2, 1);

function ComboPreview({ tasks, settings }: { tasks: Task[]; settings: Settings }) {
  const now = useNowMinute();
  const { list, tomorrow } = useDays(tasks);
  const { off, setOff, go } = useMonthNav();
  const [mode, setMode] = useState<0 | 1>(0);
  // The switch's pill (0 = Today … 1 = Month); how much each side shows, and
  // whether it's arriving (rising from below) or leaving (drifting up), as the
  // widget's flippers do.
  const pill = useSharedValue(0);
  const tV = useSharedValue(1);
  const mV = useSharedValue(0);
  const tIn = useSharedValue(1);
  const mIn = useSharedValue(1);

  const pick = (to: 0 | 1) => {
    if (to === mode) {
      if (to === 1 && off !== 0) setOff(0); // the side showing: Month goes back to this month
      return;
    }
    Haptics.selectionAsync().catch(() => {});
    setMode(to);
    pill.value = withTiming(to, { duration: ms(320), easing: EASE });
    const [arrive, leave, arriveIn, leaveIn] = to === 1 ? [mV, tV, mIn, tIn] : [tV, mV, tIn, mIn];
    arriveIn.value = 1;
    leaveIn.value = 0;
    arrive.value = withTiming(1, { duration: ms(340), easing: EASE });
    leave.value = withTiming(0, { duration: ms(200), easing: EASE });
  };

  const todayStyle = useSide(tV, tIn);
  const monthStyle = useSide(mV, mIn);
  const todayActs = useAnimatedStyle(() => ({ opacity: tV.value }));
  const monthActs = useAnimatedStyle(() => ({ opacity: mV.value }));

  const d = new Date();
  const monFirst = settings.weekStart === 'mon';
  const rowH = (COMBO_H - 30 - 17) / monthRows(off, monFirst);
  return (
    <WidgetCard>
      <View style={styles.cTop}>
        <ModeSwitch p={pill} onPick={pick} />
        <View style={{ flex: 1 }} />
        <View style={styles.cActs}>
          <Animated.View pointerEvents={mode === 0 ? 'auto' : 'none'} style={[styles.cActsSide, todayActs]}>
            <DayCount list={list} />
            <PlusBtn size={32} />
          </Animated.View>
          <Animated.View pointerEvents={mode === 1 ? 'auto' : 'none'} style={[styles.cActsSide, styles.cActsGap, monthActs]}>
            <MonthNav off={off} go={go} reset={() => setOff(0)} />
          </Animated.View>
        </View>
      </View>
      <View style={styles.cBody}>
        <Animated.View pointerEvents={mode === 0 ? 'auto' : 'none'} style={[StyleSheet.absoluteFill, todayStyle]}>
          <View style={styles.cHead}>
            <Text style={styles.tDay}>{WEEKDAYS_FULL[d.getDay()]}</Text>
            <Text style={styles.cTitleSub}>
              {MONTHS[d.getMonth()]} {d.getDate()}
            </Text>
          </View>
          <TodayBody list={list} tomorrow={tomorrow} settings={settings} now={now} maxH={COMBO_H - 58} />
        </Animated.View>
        <Animated.View pointerEvents={mode === 1 ? 'auto' : 'none'} style={[StyleSheet.absoluteFill, monthStyle]}>
          <MonthTitle off={off} style={styles.cMonthTitle} />
          <MonthGrid tasks={tasks} settings={settings} off={off} rowH={rowH} />
        </Animated.View>
      </View>
    </WidgetCard>
  );
}

// One side of Today & Month: fades as it goes, rising in from below as it arrives
// and drifting up as it leaves.
function useSide(v: SharedValue<number>, arriving: SharedValue<number>) {
  return useAnimatedStyle(() => ({ opacity: v.value, transform: [{ translateY: (arriving.value ? 10 : -6) * (1 - v.value) }] }));
}

// Today / Month: a pill glides to the side you pick; the labels change colour under it.
function ModeSwitch({ p, onPick }: { p: SharedValue<number>; onPick: (to: 0 | 1) => void }) {
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: p.value * SEG_W }] }));
  return (
    <View style={styles.seg}>
      <Animated.View style={[styles.segPill, pill]}>
        <LinearGradient colors={['rgba(124,124,240,0.18)', 'rgba(79,209,197,0.16)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <SegSide p={p} at={0} icon="list" label="Today" onPress={() => onPick(0)} />
      <SegSide p={p} at={1} icon="grid" label="Month" onPress={() => onPick(1)} />
    </View>
  );
}

function SegSide({ p, at, icon, label, onPress }: { p: SharedValue<number>; at: 0 | 1; icon: Icon; label: string; onPress: () => void }) {
  const on = useAnimatedStyle(() => ({ opacity: at === 0 ? 1 - p.value : p.value }));
  const off = useAnimatedStyle(() => ({ opacity: at === 0 ? p.value : 1 - p.value }));
  return (
    <Pressable onPress={onPress} style={styles.segSide}>
      <Animated.View style={[styles.segLbl, off]}>
        <Feather name={icon} size={12} color={C.muted} />
        <Text style={[styles.segTxt, { color: C.muted }]}>{label}</Text>
      </Animated.View>
      <Animated.View style={[styles.segLbl, StyleSheet.absoluteFill, on]}>
        <Feather name={icon} size={12} color={C.text} />
        <Text style={[styles.segTxt, { color: C.text }]}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 11, color: C.muted, fontWeight: '700', marginBottom: 9, marginTop: 20, letterSpacing: 0.3 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 20, marginBottom: 9 },
  sectionInRow: { marginTop: 0, marginBottom: 0 },
  newPill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(79,209,197,0.14)' },
  newTxt: { fontSize: 9, fontWeight: '900', color: C.accentB, letterSpacing: 0.5 },
  note: { flexDirection: 'row', gap: 9, alignItems: 'flex-start', marginTop: 10, padding: 12, borderRadius: 14, backgroundColor: 'rgba(124,124,240,0.08)' },
  noteTxt: { flex: 1, fontSize: 12.5, color: C.textDim, lineHeight: 17 },
  card: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 4 },
  tip: { flexDirection: 'row', gap: 10, paddingVertical: 10, paddingHorizontal: 2 },
  tipLine: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  tipTxt: { flex: 1, fontSize: 12.5, color: C.textDim, lineHeight: 17 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(124,124,240,0.12)',
    boxShadow: 'inset 0 0 0 1px rgba(124,124,240,0.3)',
  },
  addBtnTxt: { fontSize: 13.5, fontWeight: '800', color: C.accentA },
  onBadge: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  onBadgeTxt: { fontSize: 12.5, fontWeight: '700', color: C.accentB },
  strike: { textDecorationLine: 'line-through' },

  widget: { borderRadius: 24, padding: 12, paddingBottom: 6, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1), 0 14px 30px -14px rgba(0,0,0,0.9)' },
  tHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 4 },
  tDay: { fontSize: 17, fontWeight: '800', color: C.text },
  tDate: { fontSize: 12, color: C.muted, marginTop: 2 },
  tCount: { fontSize: 12, fontWeight: '800', color: C.textDim },
  tAdd: { alignItems: 'center', justifyContent: 'center' },
  tBar: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.08)', marginTop: 9, marginHorizontal: 4, overflow: 'hidden' },
  tBarFill: { height: 3, borderRadius: 2 },
  tAllDay: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 8, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)' },
  tAllDayTxt: { flex: 1, fontSize: 12.5, color: C.textDim },
  tList: { marginTop: 6, overflow: 'hidden' },
  cutFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 36 },

  // The timeline's rows (the widget's sizes, in dp).
  row: { flexDirection: 'row' },
  nowRow: { height: 22, justifyContent: 'center' },
  nowMark: { height: 18, justifyContent: 'center' },
  nowLine: { position: 'absolute', left: 0, right: 2, height: 1.5, backgroundColor: 'rgba(255,90,95,0.8)' },
  nowClockBox: { position: 'absolute', left: 0, width: G, alignItems: 'flex-start' },
  nowClock: { fontSize: 10.5, fontWeight: '800', color: C.now, backgroundColor: '#131316', borderRadius: 6, paddingHorizontal: 3, paddingVertical: 1, overflow: 'hidden', fontVariant: ['tabular-nums'] },
  nowDot: { position: 'absolute', left: RAIL_X - 4.5, width: 9, height: 9, borderRadius: 4.5, backgroundColor: C.now, borderWidth: 2, borderColor: '#131316' },
  cardWrap: { paddingVertical: 3 },
  cardRow: { flexDirection: 'row' },
  gut: { width: G, paddingTop: 5, paddingRight: 7, alignItems: 'flex-end' },
  gutTxt: { fontSize: 11.5, fontWeight: '800', fontVariant: ['tabular-nums'] },
  gutAp: { fontSize: 9, fontWeight: '800', color: C.faint, marginTop: 1 },
  tlCard: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#1B1C20', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  band: { width: BAND, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  bandEmoji: { fontSize: 15 },
  bandPast: { position: 'absolute', top: 0, left: 0, right: 0 },
  cardBody: { flex: 1, minWidth: 0, paddingLeft: 10 },
  cTitle: { fontSize: 14, fontWeight: '800', color: C.text },
  cTitleDone: { color: '#6A6A72', textDecorationLine: 'line-through' },
  cTime: { fontSize: 11.5, color: C.muted, marginTop: 4, fontVariant: ['tabular-nums'] },
  cMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 },
  cTag: { fontSize: 10, fontWeight: '800', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 7, overflow: 'hidden', maxWidth: 110 },
  cPlace: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 7, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', maxWidth: 110 },
  cPlaceTxt: { fontSize: 10, fontWeight: '800', color: C.muted, flexShrink: 1 },
  cSubs: { flex: 1, fontSize: 10, fontWeight: '800', color: '#6E6E76' },
  check: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: C.faint, marginLeft: 6, marginRight: 11, alignItems: 'center', justifyContent: 'center' },
  elapsed: { position: 'absolute', top: 3, left: G, right: 0, backgroundColor: 'rgba(11,11,13,0.32)', borderTopLeftRadius: 14, borderTopRightRadius: 14 },
  railCol: { width: BAND, alignItems: 'center' },
  railHalf: { width: 6, flex: 1 },
  chipWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  chip: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 7, backgroundColor: 'rgba(30,31,35,0.95)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' },
  chipTxt: { fontSize: 10.5, fontWeight: '700', color: C.muted, fontVariant: ['tabular-nums'] },
  liveTxt: { color: C.now, fontWeight: '800' },
  free: { flex: 1, marginVertical: 4, backgroundColor: 'rgba(255,255,255,0.03)', gap: 3 },
  freeLabel: { fontSize: 11.5, color: C.faint, fontVariant: ['tabular-nums'] },
  freeAdd: { fontSize: 11.5, fontWeight: '700', color: C.muted },
  redBlock: { flex: 1, marginVertical: 4, backgroundColor: 'rgba(255,90,100,0.05)' },
  edgeTxt: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.6, color: C.band, fontVariant: ['tabular-nums'] },
  ovPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, backgroundColor: 'rgba(24,14,16,0.94)', borderWidth: 1, borderColor: 'rgba(255,90,95,0.4)' },
  ovTxt: { fontSize: 10, fontWeight: '800', color: C.now, letterSpacing: 0.2, fontVariant: ['tabular-nums'] },
  noteRow: { alignItems: 'center', paddingTop: 14, paddingBottom: 12 },
  noteIcon: { width: 22, height: 22, borderRadius: 11, backgroundColor: C.accentB, alignItems: 'center', justifyContent: 'center', marginBottom: 7 },
  noteTitle: { fontSize: 14, fontWeight: '800', color: C.textDim },
  noteSub: { fontSize: 12, color: C.muted, marginTop: 4 },
  nextRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 8, paddingBottom: 6 },
  nextGut: { width: G, paddingRight: 7, textAlign: 'right', fontSize: 11.5, fontWeight: '800', color: C.faint, fontVariant: ['tabular-nums'] },
  nextCard: { flex: 1, flexDirection: 'row', alignItems: 'center', padding: 6, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.08)' },
  nextTile: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  nextEmoji: { fontSize: 14 },
  nextWhen: { fontSize: 9.5, fontWeight: '800', color: C.muted, letterSpacing: 0.6, fontVariant: ['tabular-nums'] },
  nextTitle: { fontSize: 13, fontWeight: '800', color: '#E4E4E8', marginTop: 3 },
  nextMore: { fontSize: 11, fontWeight: '800', color: '#6E6E76', marginLeft: 6, marginRight: 4 },

  mHead: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 4, paddingBottom: 6 },
  mTitle: { flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  mMonth: { fontSize: 16, fontWeight: '800', color: C.text },
  mYear: { fontSize: 13, color: C.muted },
  mToday: { paddingHorizontal: 10, height: 26, borderRadius: 13, backgroundColor: 'rgba(79,209,197,0.14)', justifyContent: 'center', marginRight: 4 },
  mTodayTxt: { fontSize: 11.5, fontWeight: '800', color: C.accentB },
  mArrow: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.07)', alignItems: 'center', justifyContent: 'center' },
  mWeek: { flexDirection: 'row', paddingBottom: 3 },
  mLetter: { flex: 1, textAlign: 'center', fontSize: 10, fontWeight: '800', color: '#6E6E76' },
  mRow: { flexDirection: 'row' },
  mCell: { flex: 1, paddingHorizontal: 1.5, paddingTop: 2, borderRadius: 8 },
  mCellToday: { backgroundColor: 'rgba(255,255,255,0.06)', boxShadow: 'inset 0 0 0 1px rgba(79,209,197,0.2)' },
  mNum: { alignSelf: 'center', width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  mNumToday: { backgroundColor: C.accentB },
  mNumTxt: { fontSize: 11, fontWeight: '800', color: '#E4E4E8' },
  mChip: { marginTop: 1.5, borderRadius: 4, paddingHorizontal: 3, paddingVertical: 1 },
  mChipTxt: { fontSize: 8.5, color: C.text },
  mMore: { fontSize: 8.5, fontWeight: '800', color: C.muted, textAlign: 'center', marginTop: 1 },

  cTop: { flexDirection: 'row', alignItems: 'center', height: 32 },
  cActs: { width: 132, height: 32 },
  cActsSide: { position: 'absolute', right: 0, top: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  cActsGap: { gap: 4 },
  cBody: { height: COMBO_H, marginTop: 10 },
  cHead: { flexDirection: 'row', alignItems: 'baseline', gap: 7, paddingLeft: 4 },
  cTitleSub: { fontSize: 12.5, color: C.muted },
  cMonthTitle: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto', paddingLeft: 4, paddingBottom: 8 },
  seg: { width: 2 * SEG_W + 6, height: 30, padding: 3, borderRadius: 12, flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  segPill: { position: 'absolute', left: 3, top: 3, width: SEG_W, bottom: 3, borderRadius: 9, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(124,124,240,0.22)' },
  segSide: { width: SEG_W, height: '100%' },
  segLbl: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, height: '100%' },
  segTxt: { fontSize: 12, fontWeight: '800' },
});
