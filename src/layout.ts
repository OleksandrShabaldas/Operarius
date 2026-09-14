import { Task } from './types';
import { PX, TOPBAND, BOTBAND, GAP, MINH, CHIPGAP } from './theme';
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
};

// Ported 1:1 from the prototype's renderVals layout pass. `startOf` lets a
// task being dragged use its live (uncommitted) start minute.
export function computeDayLayout(
  tasks: Task[],
  dayStart: number,
  dayEnd: number,
  dragId: string | null,
  dragMin: number
): DayLayout {
  const startOf = (t: Task) => (dragId === t.id ? dragMin : t.start);
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
    const h = Math.max(t.dur * PX, MINH);

    let space = GAP;
    let chipNeeded = false;
    let free = 0;
    if (prevMin != null) {
      free = s - prevMin;
      if (free > 0 && free <= 15) {
        chipNeeded = true;
        space = CHIPGAP;
      }
    }

    const top = Math.max(propTop, prevPx == null ? propTop : prevPx + space);

    if (prevMin != null && free > 15) {
      const gTop = (prevPx as number) + 4;
      const gH = top - (prevPx as number) - 8;
      if (gH >= 40) {
        freeblocks.push({
          key: `free-${prevMin}`,
          label: `${fmtDur(free)} free`,
          start: prevMin,
          top: gTop,
          height: gH,
        });
      } else {
        chipNeeded = free > 0;
      }
    }

    if (chipNeeded) {
      const cy = (prevPx as number) + (top - (prevPx as number)) / 2 - 11;
      chips.push({ key: `chip-${t.id}`, label: `${free} min`, top: cy });
    }

    pos[t.id] = { top, h };
    prevPx = top + h;
    prevMin = s + t.dur;
    maxBottom = Math.max(maxBottom, top + h);
  });

  const dayBottomPx = (dayEnd - dayStart) * PX + TOPBAND;
  const botTop = Math.max(dayBottomPx, maxBottom + 12);
  const H = botTop + BOTBAND;

  return { sorted, pos, freeblocks, chips, botTop, H };
}
