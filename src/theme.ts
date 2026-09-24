// Design tokens ported from the prototype. Single source of truth for the
// timeline geometry, palette, and picker option sets.

// Timeline geometry ---------------------------------------------------------
export const PX = 1.3; // vertical pixels per minute (tighter than the prototype)
export const TOPBAND = 46; // "beginning of day" band height reserve
export const BOTBAND = 46; // "end of day" band height reserve
export const GAP = 8; // min vertical gap between stacked cards
export const MINH = 60; // min card height (no meta row)
export const CHIPGAP = 20; // gap reserved when a "x min" pill sits between cards
export const MIN_FREE_H = 46; // min height for a tappable "free" block

// Horizontal geometry: hour labels on the far left, then the timeline rail,
// then the lane of free blocks and gap chips. A task's card spans both: its
// colour band (with the icon) sits on the rail as the card's left edge, the
// text to the right of it in the lane.
export const RAIL_X = 56; // centre of the timeline rail
export const BAND_W = 38; // width of a card's colour band
export const CARD_L = RAIL_X - BAND_W / 2; // left edge of cards (their band centred on the rail)
export const LANE_L = CARD_L + BAND_W; // left edge of free blocks, gap chips, hour lines
export const LANE_R = 16; // right inset of all of them

// Default visible day window (overridable in Settings).
export const DEFAULT_DAY_START = 7 * 60; // 07:00
export const DEFAULT_DAY_END = 23 * 60; // 23:00
export const DEFAULT_GAP_THRESHOLD = 15; // minutes

// Default quick-pick presets (overridable in Settings).
export const DEFAULT_TIME_PRESETS = [6 * 60, 8 * 60, 9 * 60, 12 * 60, 13 * 60, 17 * 60, 20 * 60];
export const DEFAULT_DURATION_PRESETS = [15, 30, 45, 60, 90, 120];

// Palette -------------------------------------------------------------------
// The palette and the icon set have a FIXED number of slots so the icon &
// colour picker always shows complete rows: 7 colours + the custom swatch make
// one row of 8, and 13 icons + the custom icon make two rows of 7. Slots are
// edited in place in Settings (never added/removed).
export const PALETTE_SLOTS = 7;
export const ICON_SLOTS = 13;

export const COLORS = ['#F8677A', '#F5A15C', '#F2C14E', '#5FD08A', '#4FD1C5', '#5B9DF9', '#B57CF0'];

// The 9-colour default older builds stored (migrated to the 7 above).
export const LEGACY_COLORS = ['#F8677A', '#F5A15C', '#F2C14E', '#5FD08A', '#4FD1C5', '#5B9DF9', '#7C7CF0', '#B57CF0', '#F072B6'];

export const EMOJIS = ['🏃', '🚿', '🍳', '💻', '👥', '🥗', '🎨', '🏋️', '📖', '☕', '📞', '✈️', '🛒'];

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
