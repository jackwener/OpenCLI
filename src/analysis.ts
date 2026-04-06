/**
 * Shared API analysis helpers used by both explore.ts and record.ts.
 *
 * Extracts common logic for:
 *   - URL pattern normalization
 *   - Array path discovery in JSON responses
 *   - Field role detection
 *   - Auth indicator inference
 *   - Capability name inference
 *   - Strategy inference
 */

import {
  VOLATILE_PARAMS,
  SEARCH_PARAMS,
  PAGINATION_PARAMS,
  LIMIT_PARAMS,
  FIELD_ROLES,
} from './constants.js';

// ── URL pattern normalization ───────────────────────────────────────────────

/** Normalize a full URL into a pattern (replace IDs, strip volatile params). */
export function urlToPattern(url: string): string {
  try {
    const p = new URL(url);
    const pathNorm = p.pathname
      .replace(/\/\d+/g, '/{id}')
      .replace(/\/[0-9a-fA-F]{8,}/g, '/{hex}')
      .replace(/\/BV[a-zA-Z0-9]{10}/g, '/{bvid}');
    const params: string[] = [];
    p.searchParams.forEach((_v, k) => { if (!VOLATILE_PARAMS.has(k)) params.push(k); });
    return `${p.host}${pathNorm}${params.length ? '?' + params.sort().map(k => `${k}={}`).join('&') : ''}`;
  } catch { return url; }
}

// ── Array discovery in JSON responses ───────────────────────────────────────

export interface ArrayDiscovery {
  path: string;
  items: unknown[];
}

/** Find the best (largest) array of objects in a JSON response body. */
export function findArrayPath(obj: unknown, depth = 0): ArrayDiscovery | null {
  if (depth > 5 || !obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) {
    if (obj.length >= 2 && obj.some(i => i && typeof i === 'object' && !Array.isArray(i))) {
      return { path: '', items: obj };
    }
    return null;
  }
  let best: ArrayDiscovery | null = null;
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    const found = findArrayPath(val, depth + 1);
    if (found) {
      const fullPath = found.path ? `${key}.${found.path}` : key;
      const candidate = { path: fullPath, items: found.items };
      if (!best || candidate.items.length > best.items.length) best = candidate;
    }
  }
  return best;
}

// ── Field flattening & role detection ───────────────────────────────────────

/** Flatten nested object keys up to maxDepth. */
export function flattenFields(obj: unknown, prefix: string, maxDepth: number): string[] {
  if (maxDepth <= 0 || !obj || typeof obj !== 'object') return [];
  const names: string[] = [];
  const record = obj as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const full = prefix ? `${prefix}.${key}` : key;
    names.push(full);
    const val = record[key];
    if (val && typeof val === 'object' && !Array.isArray(val)) names.push(...flattenFields(val, full, maxDepth - 1));
  }
  return names;
}

/** Detect semantic field roles (title, url, author, etc.) from sample fields. */
export function detectFieldRoles(sampleFields: string[]): Record<string, string> {
  const detectedFields: Record<string, string> = {};
  for (const [role, aliases] of Object.entries(FIELD_ROLES)) {
    for (const f of sampleFields) {
      if (aliases.includes(f.split('.').pop()?.toLowerCase() ?? '')) {
        detectedFields[role] = f;
        break;
      }
    }
  }
  return detectedFields;
}

// ── Capability name inference ───────────────────────────────────────────────

/** Infer a CLI capability name from a URL. */
export function inferCapabilityName(url: string, goal?: string): string {
  if (goal) return goal;
  const u = url.toLowerCase();
  if (u.includes('hot') || u.includes('popular') || u.includes('ranking') || u.includes('trending')) return 'hot';
  if (u.includes('search')) return 'search';
  if (u.includes('feed') || u.includes('timeline') || u.includes('dynamic')) return 'feed';
  if (u.includes('comment') || u.includes('reply')) return 'comments';
  if (u.includes('history')) return 'history';
  if (u.includes('profile') || u.includes('userinfo') || u.includes('/me')) return 'me';
  if (u.includes('favorite') || u.includes('collect') || u.includes('bookmark')) return 'favorite';
  try {
    const segs = new URL(url).pathname
      .split('/')
      .filter(s => s && !s.match(/^\d+$/) && !s.match(/^[0-9a-f]{8,}$/i) && !s.match(/^v\d+$/));
    if (segs.length) return segs[segs.length - 1].replace(/[^a-z0-9]/gi, '_').toLowerCase();
  } catch {}
  return 'data';
}

// ── Strategy inference ──────────────────────────────────────────────────────

/** Infer auth strategy from detected indicators. */
export function inferStrategy(authIndicators: string[]): string {
  if (authIndicators.includes('signature')) return 'intercept';
  if (authIndicators.includes('bearer') || authIndicators.includes('csrf')) return 'header';
  return 'cookie';
}

// ── Auth indicator detection ────────────────────────────────────────────────

/** Detect auth indicators from HTTP headers. */
export function detectAuthFromHeaders(headers?: Record<string, string>): string[] {
  if (!headers) return [];
  const indicators: string[] = [];
  const keys = Object.keys(headers).map(k => k.toLowerCase());
  if (keys.some(k => k === 'authorization')) indicators.push('bearer');
  if (keys.some(k => k.startsWith('x-csrf') || k.startsWith('x-xsrf'))) indicators.push('csrf');
  if (keys.some(k => k.startsWith('x-s') || k === 'x-t' || k === 'x-s-common')) indicators.push('signature');
  return indicators;
}

/** Detect auth indicators from URL and response body (heuristic). */
export function detectAuthFromContent(url: string, body: unknown): string[] {
  const indicators: string[] = [];
  if (body && typeof body === 'object') {
    const keys = Object.keys(body as object).map(k => k.toLowerCase());
    if (keys.some(k => k.includes('sign') || k === 'w_rid' || k.includes('token'))) {
      indicators.push('signature');
    }
  }
  if (url.includes('/wbi/') || url.includes('w_rid=')) indicators.push('signature');
  if (url.includes('bearer') || url.includes('access_token')) indicators.push('bearer');
  return indicators;
}

// ── Noise filtering ─────────────────────────────────────────────────────────

const NOISE_URL_PATTERN = /\/(track|log|analytics|beacon|pixel|ping|heartbeat|keep.?alive)\b/i;

/** Check whether a URL looks like tracking/telemetry noise rather than a business API. */
export function isNoiseUrl(url: string): boolean {
  return NOISE_URL_PATTERN.test(url);
}

// ── Query param classification ──────────────────────────────────────────────

/** Extract non-volatile query params and classify them. */
export function classifyQueryParams(url: string): {
  params: string[];
  hasSearch: boolean;
  hasPagination: boolean;
  hasLimit: boolean;
} {
  const params: string[] = [];
  try { new URL(url).searchParams.forEach((_v, k) => { if (!VOLATILE_PARAMS.has(k)) params.push(k); }); } catch {}
  return {
    params,
    hasSearch: params.some(p => SEARCH_PARAMS.has(p)),
    hasPagination: params.some(p => PAGINATION_PARAMS.has(p)),
    hasLimit: params.some(p => LIMIT_PARAMS.has(p)),
  };
}
