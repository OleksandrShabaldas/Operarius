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
  alt?: string; // an alternative name (e.g. a short one) — tapping the name switches between the two
  showAlt?: boolean; // the alternative name is the one shown
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
  skip?: string[]; // repeating tasks: days taken out of the series (deleted, or changed on their own)
  doneDates: string[]; // per-occurrence completion for repeating tasks
  subDone?: Record<string, string[]>; // repeating tasks: subtask ids ticked off per occurrence (YYYY-MM-DD)
  expanded: boolean; // subtasks shown inline on the card (persisted)
  starred?: boolean; // high priority: marked with a star and listed first (lists, month widget)
  cal?: CalLink; // linked to an event in the synced calendar
  reminders: Reminders | null; // null = no reminders
};

// A task's link to an event in the synced calendar.
export type CalLink = {
  key: string; // stable identity: the event's id; one occurrence of a recurring event "<eventId>@<YYYY-MM-DD>"
  id: string; // the event written to (an edited occurrence: its own exception event)
  c: string; // the calendar it lives in
  lh: string; // the task's calendar-facing fields at the last sync (hashed)
  rh: string; // the event's at the last sync (hashed)
  from?: 1; // came from the calendar (otherwise the task was sent there)
  master?: string; // one occurrence of a recurring event: that event's id…
  ob?: number; // …and the occurrence's original start (epoch ms)
  span?: 1; // a multi-day all-day event (the task repeats daily through its last day)
  x?: number; // minutes a timed event runs past midnight (the task stops at midnight)
};

// A linked task as of the last sync — so a task deleted here can be removed
// from the calendar too (t: task, k: link key, i: event, m / o: occurrence).
export type CalSeen = { t: string; k: string; i: string; m?: string; o?: number; f?: 1 };

export type CalDirection = 'both' | 'toCalendar' | 'fromCalendar';

// Another calendar synced alongside the main one: its events come in as tasks
// and edits to them go back to it (new tasks go to the main calendar). Keeps
// its own sync state, like the main one's below.
export type CalExtra = {
  id: string;
  name: string;
  account: string;
  color: string;
  seen: CalSeen[];
  ignored: string[];
  counts: { toCalendar: number; fromCalendar: number };
};

// Syncing with calendars on the phone (a Google account's calendars are
// synced to Google by the phone). `calendarId` is the main one — new tasks
// go there — and `extra` the others synced too.
export type CalendarSync = {
  on: boolean;
  calendarId: string | null;
  calendarName: string;
  account: string;
  color: string;
  direction: CalDirection;
  lastSync: number | null;
  lastError: string | null;
  seen: CalSeen[]; // every linked task as of the last sync (to notice deletions here)
  ignored: string[]; // events (keys / ids) deleted here while syncing calendar → tasks only (never brought back)
  counts: { toCalendar: number; fromCalendar: number };
  extra: CalExtra[];
};

// Which occurrences of a repeating task a change applies to.
export type RepeatScope = 'one' | 'following' | 'all';

// A task being composed/edited in the editor sheet. `id` is absent when new.
// `scope`: editing part of a repeating series — just one of its days (the
// draft becomes a task of its own) or that day and the ones after it (the
// draft becomes a new series; the old one ends the day before).
export type Draft = Omit<Task, 'id'> & { id?: string; scope?: { kind: 'one' | 'following'; baseId: string; date: string } };

export type WeekStart = 'mon' | 'sun';
export type Clock = '12h' | '24h';

// User-defined tag. Top-level when parentId is null, otherwise a sub-tag.
// `hideDots` keeps the tag's tasks (and, for a top-level tag, its sub-tags'
// tasks) out of the week strip's per-task dots. Any tag can carry an `icon`
// (emoji / 2 letters). A sub-tag has its parent's colour unless `ownColor`
// (then it keeps the one picked for it when the parent's changes).
// `intensity`: how reminders of the tag's tasks start (a sub-tag without one
// follows its parent; no tag → Settings → Reminders' default).
export type Tag = { id: string; name: string; parentId: string | null; color: string; ownColor?: boolean; hideDots?: boolean; icon?: string; intensity?: ReminderIntensity };

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
  alarmSnoozeBtn: boolean; // the full-screen reminder shows Snooze
  alarmDoneBtn: boolean; // …and Done (it can always be slid away)
  calendar: CalendarSync;
  lastBackup: { at: number; name: string } | null; // the last export
};
