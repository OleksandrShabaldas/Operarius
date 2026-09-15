export type TaskType = 'planned' | 'allday' | 'todo';

export type Subtask = { id: string; title: string; done: boolean };

export type Task = {
  id: string;
  title: string;
  emoji: string;
  color: string;
  type: TaskType;
  start: number; // minutes from midnight (planned only)
  dur: number; // minutes (planned only)
  done: boolean;
  tagId: string | null; // references Settings.tags
  placeId: string | null; // references Settings.places
  date: string | null; // YYYY-MM-DD for planned/allday; null for to-do
  notes: string;
  subtasks: Subtask[];
};

// A task being composed/edited in the editor sheet. `id` is absent when new.
export type Draft = Omit<Task, 'id'> & { id?: string };

export type WeekStart = 'mon' | 'sun';
export type Clock = '12h' | '24h';

// User-defined tag. Top-level when parentId is null, otherwise a sub-tag.
export type Tag = { id: string; name: string; parentId: string | null; color: string };

// User-defined place, shown like a tag but with a location marker.
export type Place = { id: string; name: string };

export type Settings = {
  dayStart: number; // minutes from midnight (visible window start)
  dayEnd: number; // minutes from midnight (visible window end)
  weekStart: WeekStart;
  clock: Clock; // 12h / 24h time format
  gapThreshold: number; // minutes: gaps <= this show a pill, larger show a free block
  tags: Tag[];
  places: Place[];
  timePresets: number[]; // minutes-of-day quick picks for start/end
  durationPresets: number[]; // minute quick picks for duration
};
