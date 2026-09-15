// Design tokens ported from the prototype. Single source of truth for the
// timeline geometry, palette, and picker option sets.

// Timeline geometry ---------------------------------------------------------
export const PX = 1.3; // vertical pixels per minute (tighter than the prototype)
export const TOPBAND = 46; // "beginning of day" band height reserve
export const BOTBAND = 46; // "end of day" band height reserve
export const GAP = 8; // min vertical gap between stacked cards
export const MINH = 58; // min card height
export const CHIPGAP = 26; // gap reserved when a "x min" pill sits between cards
export const MIN_FREE_H = 46; // min height for a tappable "free" block

// Default visible day window (overridable in Settings).
export const DEFAULT_DAY_START = 7 * 60; // 07:00
export const DEFAULT_DAY_END = 23 * 60; // 23:00
export const DEFAULT_GAP_THRESHOLD = 15; // minutes

// Palette -------------------------------------------------------------------
export const COLORS = [
  '#F8677A',
  '#F5A15C',
  '#F2C14E',
  '#5FD08A',
  '#4FD1C5',
  '#5B9DF9',
  '#7C7CF0',
  '#B57CF0',
  '#F072B6',
];

export const EMOJIS = ['🏃', '🚿', '🍳', '💻', '👥', '🥗', '🎨', '🏋️', '📖', '☕', '📞', '✈️'];

export const TAGS = ['Work', 'Focus', 'Health', 'Personal', 'Errand'];

export const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const WEEKDAYS_FULL = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

// Surface colors ------------------------------------------------------------
export const C = {
  bg: '#0b0b0d',
  card: '#17181b',
  sheet: '#161719',
  text: '#f4f4f6',
  textDim: '#c8c8ce',
  muted: '#8a8a92',
  faint: '#5b5b63',
  tick: '#4a4a52',
  accentA: '#7c7cf0',
  accentB: '#4fd1c5',
  danger: '#f8677a',
  now: '#ff5a5f',
  band: '#ff6b70',
};
