import { Place, PlaceLocation } from './types';

// ---------------------------------------------------------------------------
// Google Maps helpers. A place's location is picked in the Google Maps app:
// the user shares the spot ("Share → Copy link"), we read the link, recover
// its coordinates (following the short maps.app.goo.gl link if needed), and
// later open that exact link again.
// ---------------------------------------------------------------------------

const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)';

// Patterns, most precise first: the place pin (!3d…!4d…), explicit query /
// center parameters, a dropped-pin search path, the viewport centre (@lat,lng),
// geo: URIs, and the static-map preview embedded in a Maps page.
const PATTERNS: RegExp[] = [
  new RegExp(`!3d${NUM}!4d${NUM}`),
  new RegExp(`[?&](?:q|query|ll|sll|center|destination|daddr)=${NUM}(?:,|%2C)\\s*\\+?${NUM}`, 'i'),
  new RegExp(`/(?:search|place|dir)/+${NUM},\\s*\\+?${NUM}`),
  new RegExp(`@${NUM},${NUM}`),
  new RegExp(`^geo:${NUM},${NUM}`, 'i'),
  new RegExp(`(?:center|markers)=${NUM}%2C${NUM}`, 'i'),
];

const valid = (lat: number, lng: number) => isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

export function coordsFromText(s: string): { lat: number; lng: number } | null {
  if (!s) return null;
  let text = s;
  try {
    text = decodeURIComponent(s);
  } catch {
    /* keep the raw text */
  }
  for (const src of [text, s]) {
    for (const re of PATTERNS) {
      const m = re.exec(src);
      if (m) {
        const lat = parseFloat(m[1]);
        const lng = parseFloat(m[2]);
        if (valid(lat, lng)) return { lat, lng };
      }
    }
  }
  return null;
}

// The first URL in a piece of shared text ("Kyiv Pechersk Lavra\nhttps://…").
export function extractUrl(text: string): string | null {
  const m = /(https?:\/\/[^\s<>"']+|geo:[^\s<>"']+)/i.exec(text || '');
  return m ? m[1].replace(/[),.;]+$/, '') : null;
}

export function isMapsUrl(url: string): boolean {
  return /^geo:/i.test(url) || /(maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google\.|google\.[a-z.]+\/maps|\/\/maps\.)/i.test(url);
}

// A readable label for the pick: the text Maps put before the link, or the
// place name in the URL (/maps/place/<Name>/…). Generic labels are dropped.
function labelFrom(text: string, url: string, resolved: string): string {
  const before = (text || '').split(url)[0].trim().split('\n')[0].trim();
  if (before && !/^(dropped pin|shared location|location|my location)$/i.test(before) && !/^https?:/i.test(before)) return before.slice(0, 80);
  const m = /\/maps\/place\/([^/@?]+)/.exec(resolved);
  if (m) {
    try {
      const name = decodeURIComponent(m[1].replace(/\+/g, ' ')).trim();
      if (name && !/^-?\d/.test(name)) return name.slice(0, 80);
    } catch {
      /* ignore */
    }
  }
  return '';
}

// Turn copied / shared text into a location. Short links are followed to find
// the coordinates (and, failing that, read from the page's map preview).
export async function resolveMapsText(text: string): Promise<PlaceLocation | null> {
  const url = extractUrl(text);
  if (!url || !isMapsUrl(url)) return null;
  let resolved = url;
  let coords = coordsFromText(url);
  if (!coords && /^https?:/i.test(url)) {
    try {
      const res = await fetch(url, { method: 'GET', redirect: 'follow' });
      resolved = res.url || url;
      // An EU consent interstitial carries the real URL in ?continue=
      const cont = /[?&]continue=([^&]+)/.exec(resolved);
      if (/consent\.google/.test(resolved) && cont) {
        try {
          resolved = decodeURIComponent(cont[1]);
        } catch {
          /* ignore */
        }
      }
      coords = coordsFromText(resolved);
      if (!coords) coords = coordsFromText((await res.text()).slice(0, 400000));
    } catch {
      /* offline: keep the link, coordinates unknown */
    }
  }
  return { link: url, lat: coords?.lat ?? null, lng: coords?.lng ?? null, address: labelFrom(text, url, resolved) };
}

// What "Show on Google Maps" opens: the picked link (shows that exact place),
// else the coordinates, else a search for the place's name.
export function mapsUrlFor(p: Pick<Place, 'name' | 'link' | 'lat' | 'lng'>): string {
  if (p.link && isMapsUrl(p.link)) return p.link;
  if (p.lat != null && p.lng != null) return `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}`;
}

export const hasLocation = (p: Pick<Place, 'link' | 'lat' | 'lng'>) => (p.lat != null && p.lng != null) || (!!p.link && isMapsUrl(p.link));

export const fmtCoords = (lat: number, lng: number) => `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
