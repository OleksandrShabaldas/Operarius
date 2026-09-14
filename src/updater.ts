import { Platform } from 'react-native';
import * as Application from 'expo-application';
import * as IntentLauncher from 'expo-intent-launcher';
import { Directory, File, Paths } from 'expo-file-system';

// ---------------------------------------------------------------------------
// Self-update from GitHub Releases.
//
// The app is distributed as a sideloaded APK (not the Play Store), so it checks
// this public repo's "latest release" on launch and on demand, and — when a
// newer version is published — downloads the release's .apk asset and hands it
// to Android's package installer.
// ---------------------------------------------------------------------------

export const GITHUB_OWNER = 'OleksandrShabaldas';
export const GITHUB_REPO = 'Operarius';
const LATEST_RELEASE_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
export const RELEASES_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;

export type ReleaseInfo = {
  version: string; // normalized, e.g. "1.0.1"
  tag: string; // raw tag, e.g. "v1.0.1"
  name: string;
  notes: string;
  apkUrl: string | null;
  htmlUrl: string;
};

export type UpdateCheck = {
  current: string;
  available: boolean;
  release: ReleaseInfo | null;
  error?: string;
};

export function currentVersion(): string {
  return Application.nativeApplicationVersion || '0.0.0';
}

// Strip a leading "v" and any pre-release/build suffix, keeping the numeric core.
function normalizeVersion(v: string): string {
  return v.trim().replace(/^v/i, '').split(/[-+\s]/)[0];
}

// Returns true if `remote` is a strictly higher version than `current`.
export function isNewer(remote: string, current: string): boolean {
  const a = normalizeVersion(remote).split('.').map((n) => parseInt(n, 10) || 0);
  const b = normalizeVersion(current).split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

export async function fetchLatestRelease(timeoutMs = 12000): Promise<ReleaseInfo | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(LATEST_RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: ctrl.signal,
    });
    if (!res.ok) return null; // 404 = no releases yet
    const j: any = await res.json();
    if (!j || !j.tag_name) return null;
    const assets: any[] = Array.isArray(j.assets) ? j.assets : [];
    const apk = assets.find((a) => typeof a.name === 'string' && a.name.toLowerCase().endsWith('.apk'));
    return {
      version: normalizeVersion(j.tag_name),
      tag: j.tag_name,
      name: j.name || j.tag_name,
      notes: (j.body || '').trim(),
      apkUrl: apk ? apk.browser_download_url : null,
      htmlUrl: j.html_url || RELEASES_URL,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function checkForUpdate(): Promise<UpdateCheck> {
  const current = currentVersion();
  const release = await fetchLatestRelease();
  if (!release) return { current, available: false, release: null, error: 'no-release' };
  return { current, available: isNewer(release.version, current), release };
}

// Download the release APK and launch Android's package installer.
export async function downloadAndInstall(release: ReleaseInfo): Promise<void> {
  if (Platform.OS !== 'android' || !release.apkUrl) {
    throw new Error('No installable APK for this platform.');
  }
  // Fresh cache dir per install attempt.
  const dir = new Directory(Paths.cache, 'updates');
  try {
    if (dir.exists) dir.delete();
  } catch {
    /* ignore */
  }
  dir.create();

  const file = await File.downloadFileAsync(release.apkUrl, dir);
  const uri = file.contentUri; // content:// URI backed by a FileProvider
  if (!uri) throw new Error('Could not resolve the downloaded file.');

  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: uri,
    type: 'application/vnd.android.package-archive',
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
  });
}
