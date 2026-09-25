import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Files from '../modules/files';
import { parseSettings, parseTasks } from './storage';
import { Settings, Task } from './types';
import { dateKey, genId } from './utils';

// ---------------------------------------------------------------------------
// Backups — every task, tag, place (photos included) and setting in one JSON
// file, restorable on this phone or another. Left out: what only makes sense
// on this phone (its alarm sound, which of its calendars syncs, links to that
// calendar's events — a restore re-matches tasks to their events instead).
// ---------------------------------------------------------------------------

export const BACKUP_FORMAT = 'operarius-backup';
export const BACKUP_VERSION = 1;

type Photos = Record<string, { ext: string; data: string }>; // place id → image (base64)

export type BackupCounts = { tasks: number; tags: number; places: number; photos: number };

// A backup as read back, normalised and ready to restore.
export type Backup = {
  exportedAt: string; // ISO time it was made
  app: string; // the version that made it
  counts: BackupCounts;
  tasks: Task[];
  settings: Settings;
  photos: Photos;
};

export class BackupError extends Error {}

const PHOTO_REF = 'backup:'; // a place's photo inside the file

export const backupName = (at = new Date()) => `operarius-backup-${dateKey(at)}.json`;

export function countsOf(tasks: Task[], settings: Settings): BackupCounts {
  return { tasks: tasks.length, tags: settings.tags.length, places: settings.places.length, photos: settings.places.filter((p) => !!p.photoUri).length };
}

/** The backup file's text for the current data. */
export async function buildBackup(tasks: Task[], settings: Settings, app: string): Promise<{ json: string; counts: BackupCounts }> {
  const photos: Photos = {};
  for (const p of settings.places) {
    if (!p.photoUri) continue;
    try {
      const f = new File(p.photoUri);
      if (f.exists) photos[p.id] = { ext: (p.photoUri.split('.').pop() || 'jpg').split('?')[0].slice(0, 5), data: await f.base64() };
    } catch {
      // a photo that can't be read is left out
    }
  }
  const { alarmSound: _s, calendar: _c, lastBackup: _b, ...rest } = settings;
  const counts = { ...countsOf(tasks, settings), photos: Object.keys(photos).length };
  const file = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    app,
    exportedAt: new Date().toISOString(),
    counts,
    tasks: tasks.map(({ cal: _link, ...t }) => t),
    settings: { ...rest, places: rest.places.map((p) => ({ ...p, photoUri: photos[p.id] ? `${PHOTO_REF}${p.id}` : null })) },
    photos,
  };
  return { json: JSON.stringify(file), counts };
}

/**
 * Saves where the user picks — the system "Save as" screen (Downloads, Google
 * Drive, any folder; only this one file is shared with the app). Returns the
 * file's name; null = they cancelled.
 */
export async function saveFile(json: string, name: string): Promise<string | null> {
  const r = await Files.saveAs(name, 'application/json', json);
  return r ? r.name || name : null;
}

/** Hands the file to another app (Drive, email, a chat…). */
export async function share(json: string, name: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new BackupError('Sharing isn’t available on this device');
  const dir = new Directory(Paths.cache, 'backup');
  if (!dir.exists) dir.create();
  const file = new File(dir, name);
  if (file.exists) file.delete();
  file.create();
  file.write(json);
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Save your Operarius backup' });
}

/** Lets the user pick a backup file and reads it. null = they cancelled. */
export async function pickBackup(): Promise<Backup | null> {
  const r = await File.pickFileAsync({ mimeTypes: '*/*' });
  if (r.canceled || !r.result) return null;
  let raw: any;
  try {
    raw = JSON.parse(await r.result.text());
  } catch {
    throw new BackupError('That file isn’t an Operarius backup.');
  }
  return readBackup(raw);
}

export function readBackup(raw: any): Backup {
  if (!raw || typeof raw !== 'object' || raw.format !== BACKUP_FORMAT || !Array.isArray(raw.tasks)) throw new BackupError('That file isn’t an Operarius backup.');
  if (typeof raw.version !== 'number' || raw.version > BACKUP_VERSION) throw new BackupError('This backup comes from a newer Operarius — update the app, then try again.');
  const tasks = parseTasks(raw.tasks).map(({ cal: _link, ...t }) => t as Task);
  const settings = parseSettings(raw.settings);
  const photos: Photos = raw.photos && typeof raw.photos === 'object' ? raw.photos : {};
  return {
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
    app: typeof raw.app === 'string' ? raw.app : '',
    counts: { tasks: tasks.length, tags: settings.tags.length, places: settings.places.length, photos: settings.places.filter((p) => p.photoUri?.startsWith(PHOTO_REF) && photos[p.id]).length },
    tasks,
    settings,
    photos,
  };
}

/** Deletes stored place photos that no place uses any more (after all data was deleted). */
export function cleanupPhotos(keep: { photoUri: string | null }[]) {
  try {
    const dir = new Directory(Paths.document, 'places');
    if (!dir.exists) return;
    const used = new Set(keep.map((p) => p.photoUri).filter(Boolean));
    for (const item of dir.list()) if (item instanceof File && !used.has(item.uri)) item.delete();
  } catch {
    // best effort
  }
}

/** Writes the backup's place photos into the app's storage (only for `ids`, when given). */
export function restorePhotos(b: Backup, ids?: Set<string>): Settings {
  const places = b.settings.places.map((p) => {
    if (!p.photoUri?.startsWith(PHOTO_REF)) return p;
    const img = b.photos[p.id];
    if (!img || (ids && !ids.has(p.id))) return { ...p, photoUri: null };
    try {
      const dir = new Directory(Paths.document, 'places');
      if (!dir.exists) dir.create();
      const f = new File(dir, `${genId()}.${img.ext || 'jpg'}`);
      f.create();
      f.write(img.data, { encoding: 'base64' });
      return { ...p, photoUri: f.uri };
    } catch {
      return { ...p, photoUri: null };
    }
  });
  return { ...b.settings, places };
}
