// Shared helpers for the appmagic adapters.
//
// Strategy note (recorded 2026-07-17): every endpoint used by this site's
// adapters is PUBLIC_API / contract: stable. Node-side fetch with no cookie and
// no Authorization header returns 200 + JSON on all of them:
//   GET  /api/v2/top/united-apps        (top-charts)
//   GET  /api/v2/tags                   (tags)
//   GET  /api/v2/search                 (search)
//   POST /api/v2/applications/app-info            (app)
//   POST /api/v2/applications/app-info/releases   (app --releases)
//   POST /api/v2/united-publishers/search-by-ids  (publisher)
// Sending the browser's cookies changes nothing, so no adapter needs browser:true.
//
// Deliberately NOT wrapped: POST /api/v2/charts/* (exact download/revenue time
// series). Those return 401 even for a logged-in free account — they are
// premium-only, not a bug to route around.
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

export const BASE = 'https://appmagic.rocks/api/v2';
export const DOMAIN = 'appmagic.rocks';

// Store codes read off the bundle's `unitedStoresMap={5:[1,2,3],4:[2,3]}`.
// store=0 and store=6 return HTTP 400, confirming the enum is 1..5.
export const STORES = {
  all: 5,          // united: Google Play + iPhone + iPad
  ios: 4,          // united Apple: iPhone + iPad
  iphone: 2,
  ipad: 3,
  'google-play': 1,
};

// app-info addresses a single concrete store listing, so the united pseudo-
// stores (all / ios) are not selectable there.
export const APP_STORES = ['iphone', 'ipad', 'google-play'];

// Mirrors the site's own getStoreFromAppId: a numeric id is an Apple id,
// anything else is a Google Play package name.
export function inferStoreKey(storeArg, appId) {
  const explicit = String(storeArg ?? '').trim();
  if (explicit !== '') return explicit.toLowerCase();
  return /^\d+$/.test(appId) ? 'iphone' : 'google-play';
}

export function resolveStore(value, { allow } = {}) {
  const key = String(value ?? '').toLowerCase();
  const valid = allow ?? Object.keys(STORES);
  if (!valid.includes(key)) {
    throw new ArgumentError(`Unknown store "${key}". Valid: ${valid.join(', ')}`);
  }
  return STORES[key];
}

export function normalizeLimit(value, fallback, max) {
  const n = Number(value ?? fallback);
  if (!Number.isInteger(n) || n <= 0) throw new ArgumentError('limit must be a positive integer');
  if (n > max) throw new ArgumentError(`limit must be <= ${max}`);
  return n;
}

export function normalizeCountry(value, fallback = 'WW') {
  const country = String(value ?? fallback).toUpperCase();
  if (!/^[A-Z0-9]{2}$/.test(country)) {
    throw new ArgumentError(`country must be a 2-letter code (e.g. US, VN, WW), got "${country}"`);
  }
  return country;
}

// Free-tier downloads/revenue are bucketed, and the bucket is encoded in the
// number itself. Decoded from the site's own `formatPremiumValues` pipe
// (bundle main-*.js @1546984), which renders the same fields in the UI:
//
//   transform(r, i='', f='—', c=false, u=false) {
//     if (!r) return f;                                   // 0 -> "—"
//     let e = i, t = r;
//     return !u && (!this.userService.isPremium() || c) &&
//       (t === 1 ? (t = 5e3, e = '< ' + e)                // 1 -> "< 5,000"
//                : e = '> ' + e),                         // V -> "> V"
//       e + t.toLocaleString(...)
//   }
//
// So the raw number is NOT the value: 0 means "no data" (rendered as an em
// dash), 1 is a sentinel meaning "nonzero but under 5,000", and anything else
// is a lower bound. Verified against the live UI for query "knit away":
// revenue 500000 -> "> $500,000", revenue 1 -> "< $5,000", revenue 0 -> "—".
// Returning the raw number would report a $5,000-floor app as earning $1 and a
// no-data app as earning $0.
export const BUCKET_SENTINEL_CEILING = 5000;

export function decodeBucket(value) {
  if (value == null || value === 0) return { min: null, max: null };
  if (value === 1) return { min: null, max: BUCKET_SENTINEL_CEILING };
  return { min: value, max: null };
}

async function request(url, init, label) {
  let resp;
  try {
    resp = await fetch(url, {
      ...init,
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json', ...(init?.headers ?? {}) },
    });
  } catch (error) {
    throw new CommandExecutionError(`appmagic ${label} request failed: ${error?.message || error}`);
  }
  if (resp.status === 400) {
    throw new ArgumentError(`appmagic rejected the ${label} query (HTTP 400) — check the store / country / id arguments`);
  }
  // appmagic uses 401/403 exclusively for its paywall, never for a malformed
  // request (that is always a 400). Surfacing it as AuthRequiredError gives
  // callers exit code 77 instead of a generic failure they might retry forever.
  if (resp.status === 401 || resp.status === 403) {
    throw new AuthRequiredError(DOMAIN, `appmagic ${label} needs a premium plan (HTTP ${resp.status})`);
  }
  if (!resp.ok) {
    throw new CommandExecutionError(`appmagic ${label} request failed: HTTP ${resp.status}`);
  }
  return resp.json();
}

export function getJson(path, params, label) {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, String(v));
  return request(url, {}, label);
}

export function postJson(path, body, label) {
  return request(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, label);
}

export const GAMES_DOMAIN_TAG = { id: 3, name: 'Games' };

// From an app's tag list, pick the single genre a competitive comparison should
// use. Prefer the MOST SPECIFIC games-type tag (the leaf: a games tag that is
// not the parent of any other games tag on this app), because the tightest
// genre gives the closest competitive field. Falls back to the "Games" domain
// tag when the app carries no games-type sub-genre. Callers surface the chosen
// genre so the user can re-run with a broader/narrower --genre.
export function pickGamesGenre(tags) {
  const games = (Array.isArray(tags) ? tags : []).filter((t) => t?.type === 'games');
  if (games.length === 0) return { ...GAMES_DOMAIN_TAG };

  const parentIds = new Set();
  for (const t of games) {
    // parent_ids arrives as an array (search-by-ids) or a "-"-joined string
    // (top charts). Normalise both into ids.
    const raw = t?.parent_ids;
    const ids = Array.isArray(raw) ? raw : String(raw ?? '').split('-');
    for (const id of ids) if (String(id).trim() !== '') parentIds.add(String(id).trim());
  }
  // A leaf is a games tag that no other games tag lists as a parent.
  const leaves = games.filter((t) => !parentIds.has(String(t.id)));
  const chosen = (leaves.length > 0 ? leaves : games).reduce((a, b) => (Number(b.id) > Number(a.id) ? b : a));
  return { id: chosen.id, name: chosen.name };
}

// The API takes numeric tag ids; accept a human tag name too so callers do not
// have to memorise 1494 ids.
export async function resolveTag(value) {
  if (/^\d+$/.test(value)) return value;

  const catalog = await getJson('/tags', {}, 'tag lookup');
  const all = Array.isArray(catalog?.data) ? catalog.data : [];
  const hits = all.filter((t) => String(t?.name ?? '').toLowerCase() === value.toLowerCase());

  if (hits.length === 0) {
    throw new ArgumentError(`Unknown tag "${value}". Browse ids and names with: opencli appmagic tags --query ${value}`);
  }
  if (hits.length > 1) {
    const options = hits.map((t) => `${t.id} (${t.type})`).join(', ');
    throw new ArgumentError(`Tag "${value}" is ambiguous — pass one of these ids: ${options}`);
  }
  return String(hits[0].id);
}
