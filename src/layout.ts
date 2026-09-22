import { Task } from './types';
import { PX, TOPBAND, BOTBAND, GAP, MINH, CHIPGAP, MIN_FREE_H } from './theme';
import { fmtDur } from './utils';

export type Pos = { top: number; h: number };
export type FreeBlock = { key: string; label: string; start: number; top: number; height: number };
export type Chip = { key: string; label: string; top: number };
export type OverlapRegion = { key: string; top: number; height: number };

export type DayLayout = {
  sorted: Task[];
  pos: Record<string, Pos>;
  freeblocks: FreeBlock[];
  chips: Chip[];
  overlaps: OverlapRegion[];
  botTop: number;
  H: number;
  // Maps a minute-of-day to a Y coordinate that matches the laid-out cards, so
  // the now-line and hour ticks stay aligned with content even though short
  // tasks and free blocks make the timeline non-proportional.
  yAt: (min: number) => number;
};

const META_H = 26; // extra height a tag/place row adds to a card
const SUB_TOGGLE_H = 32; // "n/m subtasks" toggle row (shown whenever a card has subtasks)
const SUB_ROW_H = 25; // each inline subtask row (only when expanded)

// Extra card height from an inline subtask strip.
function subtaskHeight(t: Task): number {
  const n = t.subtasks.length;
  if (n === 0) return 0;
  return SUB_TOGGLE_H + (t.expanded ? n * SUB_ROW_H : 0);
}

// The layout always uses each task's real start (so it stays put while one card
// is being dragged — the dragged card floats separately). Tasks that overlap in
// time are stacked at their proportional positions (when `allowOverlap`), with
// their intersection reported as an overlap region; otherwise they push down.
export function computeDayLayout(
  tasks: Task[],
  dayStart: number,
  dayEnd: number,
  gapThreshold: number,
  allowOverlap: boolean
): DayLayout {
  const hasMeta = (t: Task) => !!t.tagId || !!t.placeId;
  const sorted = [...tasks].sort((a, b) => a.start - b.start || a.dur - b.dur);

  const pos: Record<string, Pos> = {};
  const freeblocks: FreeBlock[] = [];
  const chips: Chip[] = [];
  const overlaps: OverlapRegion[] = [];

  let maxBottom = TOPBAND;
  // The current "cluster": a run of time-overlapping cards kept together. When a
  // task doesn't overlap it, we close the cluster (gap/chip/free block) and open
  // a new one. Overlapping cards are placed relative to the cluster's actual
  // (possibly pushed-down) top, not their raw proportional position.
  let clusterStartMin: number | null = null; // first start time in the cluster
  let clusterStartPx = TOPBAND; // top pixel of the cluster's first card
  let clusterEndMin: number | null = null; // latest end time in the cluster
  let clusterBottom = TOPBAND; // lowest pixel in the cluster

  sorted.forEach((t) => {
    const s = t.start;
    const e = s + t.dur;
    const propTop = (s - dayStart) * PX + TOPBAND;
    const minH = MINH + (hasMeta(t) ? META_H : 0) + subtaskHeight(t);
    const h = Math.max(t.dur * PX, minH);

    let top: number;
    if (clusterStartMin == null || clusterEndMin == null) {
      // First task — leading free block from the day start if there's a gap.
      const lead = s - dayStart;
      if (lead > gapThreshold) {
        top = Math.max(propTop, TOPBAND + MIN_FREE_H + 19);
        freeblocks.push({ key: 'free-lead', label: `${fmtDur(lead)} free`, start: dayStart, top: TOPBAND + 7, height: top - TOPBAND - 14 });
      } else {
        top = propTop;
      }
      clusterStartMin = s;
      clusterStartPx = top;
      clusterEndMin = e;
      clusterBottom = top + h;
    } else if (allowOverlap && s < clusterEndMin) {
      // Genuine time overlap — position relative to the cluster's own top.
      top = Math.max(clusterStartPx + (s - clusterStartMin) * PX, clusterStartPx);
      const regBottom = Math.min(top + h, clusterBottom);
      if (regBottom - top > 6) overlaps.push({ key: `ov-${t.id}`, top, height: regBottom - top });
      clusterEndMin = Math.max(clusterEndMin, e);
      clusterBottom = Math.max(clusterBottom, top + h);
    } else {
      // New cluster — measure the gap from the previous cluster's end/bottom.
      const free = s - clusterEndMin;
      if (free > gapThreshold) {
        top = Math.max(propTop, clusterBottom + GAP, clusterBottom + MIN_FREE_H + 12);
        freeblocks.push({ key: `free-${clusterEndMin}`, label: `${fmtDur(free)} free`, start: clusterEndMin, top: clusterBottom + 7, height: top - clusterBottom - 14 });
      } else if (free > 0) {
        top = Math.max(propTop, clusterBottom + CHIPGAP);
        chips.push({ key: `chip-${t.id}`, label: `${free} min`, top: clusterBottom + (top - clusterBottom) / 2 - 10 });
      } else {
        // Adjacent, or overlapping while swapping is enabled → push down.
        top = Math.max(propTop, clusterBottom + GAP);
      }
      clusterStartMin = s;
      clusterStartPx = top;
      clusterEndMin = e;
      clusterBottom = top + h;
    }

    pos[t.id] = { top, h };
    maxBottom = Math.max(maxBottom, top + h);
  });

  const dayBottomPx = (dayEnd - dayStart) * PX + TOPBAND;
  const botTop = Math.max(dayBottomPx, maxBottom + 12);
  const H = botTop + BOTBAND;

  // Trailing free block from the last cluster to the end of the day.
  if (clusterEndMin != null && clusterBottom != null && dayEnd - clusterEndMin > gapThreshold && botTop - clusterBottom - 14 >= MIN_FREE_H) {
    freeblocks.push({ key: 'free-trail', label: `${fmtDur(dayEnd - clusterEndMin)} free`, start: clusterEndMin, top: clusterBottom + 7, height: botTop - clusterBottom - 14 });
  }

  // Build monotonic (minute -> y) anchors from the laid-out cards.
  const anchors: { min: number; y: number }[] = [{ min: dayStart, y: TOPBAND }];
  sorted.forEach((t) => {
    const p = pos[t.id];
    anchors.push({ min: t.start, y: p.top });
    anchors.push({ min: t.start + t.dur, y: p.top + p.h });
  });
  anchors.push({ min: dayEnd, y: botTop });
  anchors.sort((a, b) => a.min - b.min || a.y - b.y);

  const yAt = (m: number): number => {
    if (m <= anchors[0].min) return anchors[0].y + (m - anchors[0].min) * PX;
    for (let i = 1; i < anchors.length; i++) {
      if (m <= anchors[i].min) {
        const a = anchors[i - 1];
        const b = anchors[i];
        if (b.min === a.min) return b.y;
        return a.y + ((b.y - a.y) * (m - a.min)) / (b.min - a.min);
      }
    }
    const last = anchors[anchors.length - 1];
    return last.y + (m - last.min) * PX;
  };

  return { sorted, pos, freeblocks, chips, overlaps, botTop, H, yAt };
}
