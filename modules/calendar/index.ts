import { NativeModule, requireOptionalNativeModule } from 'expo';

// ---------------------------------------------------------------------------
// Operarius calendar — the JS face of the Android module in ./android: the
// phone's calendars through Android's Calendar Provider. A Google account's
// calendars are among them (the phone itself keeps those in sync with
// Google), so this is how tasks meet Google Calendar. Anywhere the module
// isn't linked (web) every call is a harmless no-op.
// ---------------------------------------------------------------------------

export type DeviceCalendar = {
  id: string;
  name: string;
  account: string; // e.g. the Google account's address
  accountType: string; // "com.google" for Google calendars, "LOCAL" for phone-only ones
  color: string; // #RRGGBB
  writable: boolean;
  visible: boolean;
  primary: boolean;
};

// One occurrence of an event within a window.
export type CalInstance = {
  eventId: string; // the event (for a moved occurrence: the exception event)
  begin: number; // epoch ms (all-day: UTC midnight)
  end: number;
  allDay: boolean;
  title: string;
  description: string;
  rrule: string | null; // set on occurrences of a recurring event
  timeZone: string | null;
  originalId: string | null; // a moved occurrence: the recurring event it belongs to
  originalBegin: number | null; // … and when it was originally
  color: string | null; // #RRGGBB as the calendar shows it
  location: string;
  appUri: string | null; // set on the app's own events: the task it shows
};

export type CalEvent = {
  id: string;
  title: string;
  description: string;
  start: number;
  end: number | null; // null for a recurring event (it has a duration instead)
  duration: string | null; // RFC 5545, e.g. "P1800S", "P1D"
  allDay: boolean;
  rrule: string | null;
  timeZone: string | null;
  calendarId: string;
  color: string | null;
  location: string;
  appUri: string | null;
  originalId: string | null; // an exception (a changed occurrence): its recurring event…
  originalBegin: number | null; // …and the occurrence's original start
};

export type EventInput = {
  title: string;
  description: string;
  start: number; // epoch ms (all-day: UTC midnight)
  end: number;
  allDay: boolean;
  timeZone: string; // "" = the phone's zone
  rrule: string | null;
  appUri: string | null; // the app's own event: the task it shows
};

type Events = { onChange: (e: { at: number }) => void };

declare class CalendarNative extends NativeModule<Events> {
  permission(): Promise<'granted' | 'denied'>;
  requestPermission(): Promise<boolean>;
  calendars(): Promise<DeviceCalendar[]>;
  instances(calendarId: string, from: number, to: number): Promise<CalInstance[]>;
  event(id: string): Promise<CalEvent | null>;
  events(ids: string[]): Promise<CalEvent[]>;
  exceptions(masterIds: string[]): Promise<CalEvent[]>;
  upsert(calendarId: string, id: string | null, e: EventInput): Promise<string>;
  remove(id: string): Promise<boolean>;
  upsertOccurrence(masterId: string, originalBegin: number, exceptionId: string | null, e: EventInput): Promise<string>;
  cancelOccurrence(masterId: string, originalBegin: number, exceptionId: string | null): Promise<boolean>;
  refresh(calendarId: string): Promise<boolean>;
  watch(on: boolean): Promise<boolean>;
}

const native = requireOptionalNativeModule<CalendarNative>('OperariusCalendar');

export const available = !!native;

const need = () => {
  if (!native) throw new Error('Calendar sync is only available on Android');
  return native;
};

export const permission = async (): Promise<'granted' | 'denied'> => (native ? native.permission() : 'denied');
export const requestPermission = async (): Promise<boolean> => (native ? native.requestPermission() : false);
export const calendars = async (): Promise<DeviceCalendar[]> => (native ? native.calendars() : []);
export const instances = async (calendarId: string, from: number, to: number): Promise<CalInstance[]> => (native ? native.instances(calendarId, from, to) : []);
export const event = async (id: string): Promise<CalEvent | null> => (native ? native.event(id) : null);
export const events = async (ids: string[]): Promise<CalEvent[]> => (native && ids.length ? native.events(ids) : []);
/** The changed occurrences of these recurring events (cancelled ones left out). */
export const exceptions = async (masterIds: string[]): Promise<CalEvent[]> => (native && masterIds.length ? native.exceptions(masterIds) : []);
export const upsert = (calendarId: string, id: string | null, e: EventInput): Promise<string> => need().upsert(calendarId, id, e);
export const remove = async (id: string): Promise<boolean> => (native ? native.remove(id) : false);
export const upsertOccurrence = (masterId: string, originalBegin: number, exceptionId: string | null, e: EventInput): Promise<string> =>
  need().upsertOccurrence(masterId, originalBegin, exceptionId, e);
export const cancelOccurrence = async (masterId: string, originalBegin: number, exceptionId: string | null): Promise<boolean> =>
  native ? native.cancelOccurrence(masterId, originalBegin, exceptionId) : false;
/** Asks the calendar's account (Google) to sync now. */
export const refresh = async (calendarId: string): Promise<boolean> => (native ? native.refresh(calendarId).catch(() => false) : false);

/** Calls `cb` (debounced) whenever the phone's calendars change. */
export function watch(cb: () => void): () => void {
  if (!native) return () => {};
  const sub = native.addListener('onChange', () => cb());
  native.watch(true).catch(() => {});
  return () => {
    sub.remove();
    native.watch(false).catch(() => {});
  };
}
