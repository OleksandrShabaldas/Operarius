export type Task = {
  id: string;
  title: string;
  emoji: string;
  color: string;
  start: number; // minutes from midnight
  dur: number; // minutes
  done: boolean;
  tag: string;
  date: string; // YYYY-MM-DD (local day the task is scheduled on)
};

// A task being composed/edited in the editor sheet. `id` is absent when new.
export type Draft = Omit<Task, 'id'> & { id?: string };

export type WeekStart = 'mon' | 'sun';

export type Settings = {
  dayStart: number; // minutes from midnight (visible window start)
  dayEnd: number; // minutes from midnight (visible window end)
  weekStart: WeekStart;
};
