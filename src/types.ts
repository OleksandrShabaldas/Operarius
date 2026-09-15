export type Task = {
  id: string;
  title: string;
  emoji: string;
  color: string;
  start: number; // minutes from midnight
  dur: number; // minutes
  done: boolean;
  tagId: string | null; // references Settings.tags
  placeId: string | null; // references Settings.places
  date: string; // YYYY-MM-DD (local day the task is scheduled on)
};

// A task being composed/edited in the editor sheet. `id` is absent when new.
export type Draft = Omit<Task, 'id'> & { id?: string };

export type WeekStart = 'mon' | 'sun';

// User-defined tag. Top-level when parentId is null, otherwise a sub-tag.
export type Tag = { id: string; name: string; parentId: string | null };

// User-defined place, shown like a tag but with a location marker.
export type Place = { id: string; name: string };

export type Settings = {
  dayStart: number; // minutes from midnight (visible window start)
  dayEnd: number; // minutes from midnight (visible window end)
  weekStart: WeekStart;
  gapThreshold: number; // minutes: gaps <= this show a pill, larger show a free block
  tags: Tag[];
  places: Place[];
};
