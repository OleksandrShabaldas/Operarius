import { Task } from './types';
import { PX, TOPBAND, BOTBAND, GAP, MINH, CHIPGAP, MIN_FREE_H } from './theme';
import { fmtDur } from './utils';

// A card's slot. `joinTop` / `joinBottom` mark the edges fused to an overlap
// band (squared corners so the stack reads as one continuous shape).
export type Pos = { top: number; h: number; joinTop?: boolean; joinBottom?: boolean };
// A gap between tasks. `end` is where it stops: the next task's start
// (`bounded`) or the end of the day.
export type FreeBlock = { key: string; label: string; start: number; end: number; bounded: boolean; top: number; height: number };
export type Chip = { key: string; label: string; start: number; end: number; top: number };
// The striped bridge fusing two time-overlapping cards. Its height grows gently
// with the overlap, so ten minutes reads as small and an hour as substantial.
export type OverlapBand = {
  key: string;
  top: number;
  height: number;
  minutes: number; // how long the two tasks overlap
  full: boolean; // the lower task lies entirely inside the time above it
  colorA: string; // upper card
  colorB: string; // lower card
  endMin: number; // latest end of the two (for past/greyed state)
};

export type DayLayout = {
  sorted: Task[];
  pos: Record<string, Pos>;
  freeblocks: FreeBlock[];
  chips: Chip[];
  overlaps: OverlapBand[];
  botTop: number;
  H: number;
  // Minute ⇄ Y through the actual (non-proportional) layout, so the ruler,
  // the now-line and dragging all agree with what is on screen.
  yAt: (min: number) => number;
  yToMin: (y: number) => number;
};

const META_H = 26; // extra height a tag/place row adds to a card
const SUB_TOGGLE_H = 32; // "n/m subtasks" toggle row (shown whenever a card has subtasks)
const SUB_ROW_H = 25; // each inline subtask row (only when expanded)

function subtaskHeight(t: Task): number {
  const n = t.subtasks.length;
  if (n === 0) return 0;
  return SUB_TOGGLE_H + (t.expanded ? n * SUB_ROW_H : 0);
}
const hasMeta = (t: Task) => !!t.tagId || !!t.placeId;

// Rendered height of a task card (duration-proportional, never below its content).
export function cardHeight(t: Task): number {
  return Math.max(t.dur * PX, MINH + (hasMeta(t) ? META_H : 0) + subtaskHeight(t));
}

export function overlapBandHeight(minutes: number): number {
  return Math.round(Math.min(46, Math.max(30, 24 + minutes * 0.3)));
}

type Cluster = { startMin: number; endMin: number; top: number; bottom: number };

// Minimum distance below the previous cluster for a task that starts `free`
// minutes after it ends. Strictly increasing in `free` — no flat stretches — so
// every 5-minute step moves a card (and a drag's landing slot) at least a few
// pixels, even where short cards are taller than their duration. The jump at
// the threshold is where a "x min" pill becomes a tappable free block.
function minOffset(free: number, thr: number): number {
  if (free <= 0) return GAP;
  if (free <= thr) return CHIPGAP + (free - 1) * 0.9;
  return MIN_FREE_H + 12 + (free - thr - 1) * 0.8;
}

// Lays the day out top-to-bottom. Tasks that don't overlap push down with free
// blocks / gap chips between them; tasks that overlap in time are stacked into
// one fused cluster joined by overlap bands (never drawn on top of each other).
export function computeDayLayout(tasks: Task[], dayStart: number, dayEnd: number, gapThreshold: number): DayLayout {
  const sorted = [...tasks].sort((a, b) => a.start - b.start || b.dur - a.dur || (a.id < b.id ? -1 : 1));

  const pos: Record<string, Pos> = {};
  const freeblocks: FreeBlock[] = [];
  const chips: Chip[] = [];
  const overlaps: OverlapBand[] = [];
  const clusters: Cluster[] = [];

  let cur: Cluster | null = null;
  let prev: Task | null = null;
  let maxBottom = TOPBAND;

  for (const t of sorted) {
    const s = t.start;
    const e = s + t.dur;
    const h = cardHeight(t);
    const propTop = (s - dayStart) * PX + TOPBAND;
    let top: number;
    let joinTop = false;

    if (!cur) {
      // First task — a leading free block from the day start if there's a gap.
      const lead = s - dayStart;
      if (lead > gapThreshold) {
        top = Math.max(propTop, TOPBAND + 7 + minOffset(lead, gapThreshold));
        freeblocks.push({ key: 'free-lead', label: `${fmtDur(lead)} free`, start: dayStart, end: s, bounded: true, top: TOPBAND + 7, height: top - TOPBAND - 14 });
      } else {
        top = Math.max(propTop, TOPBAND);
      }
      cur = { startMin: s, endMin: e, top, bottom: top + h };
    } else if (s < cur.endMin && prev) {
      // Overlaps the running cluster — fuse beneath the previous card.
      const minutes = Math.min(cur.endMin, e) - s;
      const bh = overlapBandHeight(minutes);
      overlaps.push({
        key: `ov-${prev.id}-${t.id}`,
        top: cur.bottom,
        height: bh,
        minutes,
        full: e <= cur.endMin,
        colorA: prev.color,
        colorB: t.color,
        endMin: Math.max(prev.start + prev.dur, e),
      });
      pos[prev.id] = { ...pos[prev.id], joinBottom: true };
      top = cur.bottom + bh;
      joinTop = true;
      cur.endMin = Math.max(cur.endMin, e);
      cur.bottom = top + h;
    } else {
      // A new cluster — show the gap from the previous one.
      clusters.push(cur);
      const free = s - cur.endMin;
      top = Math.max(propTop, cur.bottom + minOffset(free, gapThreshold));
      if (free > gapThreshold) {
        // Keyed by the task it follows, so a block survives layout changes
        // (e.g. lifting a card) and glides to its new size instead of popping.
        freeblocks.push({ key: `free-after-${prev!.id}`, label: `${fmtDur(free)} free`, start: cur.endMin, end: s, bounded: true, top: cur.bottom + 7, height: top - cur.bottom - 14 });
      } else if (free > 0) {
        chips.push({ key: `chip-${t.id}`, label: `${free} min`, start: cur.endMin, end: s, top: cur.bottom + (top - cur.bottom) / 2 - 10 });
      }
      cur = { startMin: s, endMin: e, top, bottom: top + h };
    }

    pos[t.id] = { top, h, joinTop };
    maxBottom = Math.max(maxBottom, top + h);
    prev = t;
  }
  if (cur) clusters.push(cur);

  const dayBottomPx = (dayEnd - dayStart) * PX + TOPBAND;
  const botTop = Math.max(dayBottomPx, maxBottom + 12);
  const H = botTop + BOTBAND;

  // Trailing free block from the last cluster to the end of the day.
  const last = clusters[clusters.length - 1];
  if (last && prev && dayEnd - last.endMin > gapThreshold && botTop - last.bottom - 14 >= MIN_FREE_H) {
    freeblocks.push({ key: `free-after-${prev.id}`, label: `${fmtDur(dayEnd - last.endMin)} free`, start: last.endMin, end: dayEnd, bounded: false, top: last.bottom + 7, height: botTop - last.bottom - 14 });
  }

  // Minute → Y anchors, one pair per cluster (not per card: inside an overlap
  // cluster card order ≠ time order). Y is forced non-decreasing so the ruler
  // can never run backwards.
  const raw: { min: number; y: number }[] = [{ min: dayStart, y: TOPBAND }];
  for (const c of clusters) {
    raw.push({ min: c.startMin, y: c.top });
    raw.push({ min: c.endMin, y: c.bottom });
  }
  raw.push({ min: dayEnd, y: botTop });
  raw.sort((a, b) => a.min - b.min || a.y - b.y);
  const anchors: { min: number; y: number }[] = [];
  for (const a of raw) {
    const prevY = anchors.length ? anchors[anchors.length - 1].y : -Infinity;
    anchors.push({ min: a.min, y: Math.max(a.y, prevY) });
  }

  const yAt = (m: number): number => {
    if (m <= anchors[0].min) return anchors[0].y + (m - anchors[0].min) * PX;
    for (let i = 1; i < anchors.length; i++) {
      const b = anchors[i];
      if (m <= b.min) {
        const a = anchors[i - 1];
        if (b.min === a.min) return a.y;
        return a.y + ((b.y - a.y) * (m - a.min)) / (b.min - a.min);
      }
    }
    const z = anchors[anchors.length - 1];
    return z.y + (m - z.min) * PX;
  };

  const yToMin = (y: number): number => {
    if (y <= anchors[0].y) return anchors[0].min + (y - anchors[0].y) / PX;
    for (let i = 1; i < anchors.length; i++) {
      const b = anchors[i];
      if (y <= b.y) {
        const a = anchors[i - 1];
        if (b.y === a.y) return a.min;
        return a.min + ((b.min - a.min) * (y - a.y)) / (b.y - a.y);
      }
    }
    const z = anchors[anchors.length - 1];
    return z.min + (y - z.y) / PX;
  };

  return { sorted, pos, freeblocks, chips, overlaps, botTop, H, yAt, yToMin };
}

// ---------------------------------------------------------------------------
// Dragging. While a card is held, the day is shown as it WILL look once the
// card lands there — room is made for it and overlaps fuse with their band —
// so nothing moves on drop. The finger maps to a time through a "drag ruler":
// for every 5-minute start, the y of the card's slot in that preview; except
// where the card would start inside another task (it fuses *below* that task),
// where the ruler runs through that task's own card instead, so hovering over a
// task reads as overlapping it, minute by minute.
// ---------------------------------------------------------------------------
export type DragRuler = {
  layoutAt: (start: number) => DayLayout; // the day with the card landed at `start`
  yOf: (min: number) => number; // start time → card-top y
  minOf: (y: number) => number; // card-top y → start time (unsnapped)
};

export function buildDragRuler(dragged: Task, others: Task[], dayStart: number, dayEnd: number, gapThreshold: number): DragRuler {
  const cache = new Map<number, DayLayout>();
  const layoutAt = (start: number) => {
    let L = cache.get(start);
    if (!L) {
      L = computeDayLayout([...others, { ...dragged, start }], dayStart, dayEnd, gapThreshold);
      cache.set(start, L);
    }
    return L;
  };
  const without = computeDayLayout(others, dayStart, dayEnd, gapThreshold);

  const ts: number[] = [];
  const ys: number[] = [];
  const first = Math.ceil(dayStart / 5) * 5;
  for (let t = first; t <= dayEnd - 5; t += 5) {
    const p = layoutAt(t).pos[dragged.id];
    let y = p && !p.joinTop ? p.top : without.yAt(t);
    if (ys.length) y = Math.max(y, ys[ys.length - 1]); // never runs backwards
    ts.push(t);
    ys.push(y);
  }
  const n = ts.length;

  const yOf = (m: number): number => {
    if (n === 0) return TOPBAND;
    if (m <= ts[0]) return ys[0] - (ts[0] - m) * PX;
    if (m >= ts[n - 1]) return ys[n - 1] + (m - ts[n - 1]) * PX;
    const i = Math.floor((m - ts[0]) / 5);
    const f = (m - ts[i]) / 5;
    return ys[i] + (ys[i + 1] - ys[i]) * f;
  };

  const minOf = (y: number): number => {
    if (n === 0) return dayStart;
    if (y <= ys[0]) return ts[0] - (ys[0] - y) / PX;
    if (y >= ys[n - 1]) return ts[n - 1] + (y - ys[n - 1]) / PX;
    // Largest i with ys[i] <= y (flat runs resolve to their last time).
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ys[mid] <= y) lo = mid;
      else hi = mid - 1;
    }
    const a = ys[lo];
    const b = ys[lo + 1];
    return b > a ? ts[lo] + ((y - a) / (b - a)) * 5 : ts[lo];
  };

  return { layoutAt, yOf, minOf };
}

// "Push apart" drop: slide a dropped task to the nearest side of whatever it
// lands on (before if dropped on the upper half, after otherwise), repeating
// in that direction until it no longer overlaps anything.
export function resolvePushApart(start: number, dur: number, others: { start: number; dur: number }[]): number {
  let s = start;
  let dir = 0;
  for (let i = 0; i < 16; i++) {
    const hit = others.find((o) => o.start < s + dur && s < o.start + o.dur);
    if (!hit) return Math.max(0, s);
    if (dir === 0) dir = s + dur / 2 < hit.start + hit.dur / 2 ? -1 : 1;
    s = dir < 0 ? hit.start - dur : hit.start + hit.dur;
  }
  return Math.max(0, s);
}
