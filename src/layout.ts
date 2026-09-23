import { Task } from './types';
import { PX, TOPBAND, BOTBAND, GAP, MINH, CHIPGAP, MIN_FREE_H } from './theme';
import { fmtDur } from './utils';

// A card's slot. `joinTop` / `joinBottom` mark the edges fused to an overlap
// band (squared corners so the stack reads as one continuous shape).
export type Pos = { top: number; h: number; joinTop?: boolean; joinBottom?: boolean };
export type FreeBlock = { key: string; label: string; start: number; top: number; height: number };
export type Chip = { key: string; label: string; top: number };
// The striped bridge fusing two time-overlapping cards. Its height grows gently
// with the overlap, so ten minutes reads as small and an hour as substantial.
export type OverlapBand = {
  key: string;
  top: number;
  height: number;
  minutes: number; // how long the two tasks overlap
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
        top = Math.max(propTop, TOPBAND + MIN_FREE_H + 19);
        freeblocks.push({ key: 'free-lead', label: `${fmtDur(lead)} free`, start: dayStart, top: TOPBAND + 7, height: top - TOPBAND - 14 });
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
      if (free > gapThreshold) {
        top = Math.max(propTop, cur.bottom + MIN_FREE_H + 12);
        // Keyed by the task it follows, so a block survives layout changes
        // (e.g. lifting a card) and glides to its new size instead of popping.
        freeblocks.push({ key: `free-after-${prev!.id}`, label: `${fmtDur(free)} free`, start: cur.endMin, top: cur.bottom + 7, height: top - cur.bottom - 14 });
      } else if (free > 0) {
        top = Math.max(propTop, cur.bottom + CHIPGAP);
        chips.push({ key: `chip-${t.id}`, label: `${free} min`, top: cur.bottom + (top - cur.bottom) / 2 - 10 });
      } else {
        top = Math.max(propTop, cur.bottom + GAP);
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
    freeblocks.push({ key: `free-after-${prev.id}`, label: `${fmtDur(dayEnd - last.endMin)} free`, start: last.endMin, top: last.bottom + 7, height: botTop - last.bottom - 14 });
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
