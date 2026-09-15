import { Task } from './types';
import { PX, TOPBAND, BOTBAND, GAP, MINH, CHIPGAP, MIN_FREE_H } from './theme';
import { fmtDur } from './utils';

export type Pos = { top: number; h: number };
export type FreeBlock = { key: string; label: string; start: number; top: number; height: number };
export type Chip = { key: string; label: string; top: number };

export type DayLayout = {
  sorted: Task[];
  pos: Record<string, Pos>;
  freeblocks: FreeBlock[];
  chips: Chip[];
  botTop: number;
  H: number;
  // Maps a minute-of-day to a Y coordinate that matches the laid-out cards, so
  // the now-line and hour ticks stay aligned with content even though short
  // tasks and free blocks make the timeline non-proportional.
  yAt: (min: number) => number;
};

const META_H = 26; // extra height a tag/place row adds to a card

export function computeDayLayout(
  tasks: Task[],
  dayStart: number,
  dayEnd: number,
  dragId: string | null,
  dragMin: number,
  gapThreshold: number
): DayLayout {
  const startOf = (t: Task) => (dragId === t.id ? dragMin : t.start);
  const hasMeta = (t: Task) => !!t.tagId || !!t.placeId;
  const sorted = [...tasks].sort((a, b) => startOf(a) - startOf(b));

  const pos: Record<string, Pos> = {};
  const freeblocks: FreeBlock[] = [];
  const chips: Chip[] = [];

  let prevPx: number | null = null;
  let prevMin: number | null = null;
  let maxBottom = TOPBAND;

  sorted.forEach((t) => {
    const s = startOf(t);
    const propTop = (s - dayStart) * PX + TOPBAND;
    const minH = MINH + (hasMeta(t) ? META_H : 0);
    const h = Math.max(t.dur * PX, minH);

    let top: number;
    if (prevPx == null || prevMin == null) {
      top = propTop;
    } else {
      const free = s - prevMin;
      if (free > gapThreshold) {
        const natural = Math.max(propTop, prevPx + GAP);
        top = Math.max(natural, prevPx + MIN_FREE_H + 12);
        freeblocks.push({
          key: `free-${prevMin}`,
          label: `${fmtDur(free)} free`,
          start: prevMin,
          top: prevPx + 7,
          height: top - prevPx - 14,
        });
      } else if (free > 0) {
        top = Math.max(propTop, prevPx + CHIPGAP);
        chips.push({ key: `chip-${t.id}`, label: `${free} min`, top: prevPx + (top - prevPx) / 2 - 10 });
      } else {
        top = Math.max(propTop, prevPx + GAP);
      }
    }

    pos[t.id] = { top, h };
    prevPx = top + h;
    prevMin = s + t.dur;
    maxBottom = Math.max(maxBottom, top + h);
  });

  const dayBottomPx = (dayEnd - dayStart) * PX + TOPBAND;
  const botTop = Math.max(dayBottomPx, maxBottom + 12);
  const H = botTop + BOTBAND;

  // Build monotonic (minute -> y) anchors from the laid-out cards.
  const anchors: { min: number; y: number }[] = [{ min: dayStart, y: TOPBAND }];
  sorted.forEach((t) => {
    const s = startOf(t);
    const p = pos[t.id];
    anchors.push({ min: s, y: p.top });
    anchors.push({ min: s + t.dur, y: p.top + p.h });
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

  return { sorted, pos, freeblocks, chips, botTop, H, yAt };
}
