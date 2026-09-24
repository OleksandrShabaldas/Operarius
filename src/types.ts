export type TaskType = 'planned' | 'allday' | 'todo';

export type Subtask = { id: string; title: string; done: boolean };

export type RepeatFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';

export type Repeat = {
  freq: RepeatFreq;
  interval: number; // every N days/weeks/months/years
  weekdays: number[]; // weekly only: 0=Sun … 6=Sat
  monthlyMode: 'date' | 'weekday'; // monthly: same day-of-month, or same weekday-of-month
  endDate: string | null; // YYYY-MM-DD, or null = forever
};

// How hard a reminder tries to get your attention:
//   easy    — a notification
//   medium  — a full-screen reminder over any app + one short buzz + a notification
//   intense — a full-screen alarm that rings and vibrates in pulses until dismissed
export type ReminderIntensity = 'easy' | 'medium' | 'intense';

// A reminder at a fixed local date & time (works for every task type).
export type CustomReminder = { id: string; date: string; min: number }; // YYYY-MM-DD + minutes from midnight

// A task's reminders. The relative ones follow the task when it moves (and fire
// for every occurrence of a repeating task); custom ones stay at their date & time.
export type Reminders = {
  before: number | null; // minutes before the task starts (0 = at the start); null = off
  after: number | null; // minutes after the task ends (0 = at the end); null = off
  custom: CustomReminder[];
  intensity: ReminderIntensity;
};

export type Task = {
  id: string;
  title: string;
  emoji: string;
  color: string;
  type: TaskType;
  start: number; // minutes from midnight (planned only)
  dur: number; // minutes (planned only)
  done: boolean; // non-repeating completion
  tagId: string | null; // references Settings.tags
  placeId: string | null; // references Settings.places
  date: string | null; // YYYY-MM-DD for planned/allday; null for to-do (base/first date if repeating)
  notes: string;
  subtasks: Subtask[];
  repeat: Repeat | null; // recurrence rule (planned/allday)
  doneDates: string[]; // per-occurrence completion for repeating tasks
  subDone?: Record<string, string[]>; // repeating tasks: subtask ids ticked off per occurrence (YYYY-MM-DD)
  expanded: boolean; // subtasks shown inline on the card (persisted)
  reminders: Reminders | null; // null = no reminders
};

// A task being composed/edited in the editor sheet. `id` is absent when new.
export type Draft = Omit<Task, 'id'> & { id?: string };

export type WeekStart = 'mon' | 'sun';
export type Clock = '12h' | '24h';

// User-defined tag. Top-level when parentId is null, otherwise a sub-tag.
// `hideDots` keeps the tag's tasks (and, for a top-level tag, its sub-tags'
// tasks) out of the week strip's per-task dots. Sub-tags share their parent's
// colour, so they can carry an `icon` (emoji / 2 letters) to tell them apart.
export type Tag = { id: string; name: string; parentId: string | null; color: string; hideDots?: boolean; icon?: string };

// User-defined place. May belong to a (top-level) tag, carry a location picked
// on Google Maps, and hold a photo.
export type Place = {
  id: string;
  name: string;
  tagId: string | null; // top-level tag it's filed under (null = Untagged)
  link: string; // the Google Maps link it was picked from (opens that exact place)
  photoUri: string | null; // local persisted image URI
  lat: number | null; // coordinates of the picked spot
  lng: number | null;
  address: string; // the label that came with the pick (e.g. the place's name on Maps)
};

// A location picked on Google Maps.
export type PlaceLocation = { link: string; lat: number | null; lng: number | null; address: string };

// A quick-pick preset, optionally scoped to a top-level tag (null = global).
export type Preset = { value: number; tagId: string | null };

export type Settings = {
  dayStart: number; // minutes from midnight (visible window start)
  dayEnd: number; // minutes from midnight (visible window end)
  weekStart: WeekStart;
  clock: Clock; // 12h / 24h time format
  gapThreshold: number; // minutes: gaps <= this show a pill, larger show a free block
  tags: Tag[];
  places: Place[];
  timePresets: Preset[]; // minutes-of-day quick picks for start/end
  durationPresets: Preset[]; // minute quick picks for duration
  colors: string[]; // the task color palette (editable)
  emojis: string[]; // the task icon set (editable)
  swapOnDrag: boolean; // dragging a task past another swaps them (off = allow overlap)
  animations: boolean; // app-wide animations on/off
  animSpeed: number; // animation speed: 0.5 (half speed) … 1 (normal) … 4 (four times faster)
  // Reminders
  remindersOn: boolean; // master switch (off = nothing notifies or rings)
  reminderDefault: { before: number | null; intensity: ReminderIntensity }; // what a new task starts with
  snoozeMin: number; // snooze length (minutes)
  ringMin: number; // how long an intense alarm rings before it gives up (minutes; 0 = until dismissed)
  alarmSound: { uri: string; name: string } | null; // null = the phone's default alarm sound
  alarmVibrate: boolean; // intense alarms vibrate in pulses
  alarmGentle: boolean; // intense alarms fade in instead of starting at full volume
};
