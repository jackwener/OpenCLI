/**
 * Analysis helpers for recorded API requests.
 *
 * URL pattern normalization, auth detection, array path finding,
 * capability name inference, strategy inference, and request scoring.
 */

import {
  VOLATILE_PARAMS,
  SEARCH_PARAMS,
  PAGINATION_PARAMS,
  FIELD_ROLES,
} from '../constants.js';
import type { RecordedRequest } from './types.js';

/**
 * Normalize a URL into a pattern by replacing dynamic segments.
 */
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

/**
 * Detect authentication indicators from URL patterns and response body fields.
 */
export function detectAuthIndicators(url: string, body: unknown): string[] {
  const indicators: string[] = [];
  // Heuristic: if body contains sign/w_rid fields, it's likely signed
  if (body && typeof body === 'object') {
    const keys = Object.keys(body as object).map(k => k.toLowerCase());
    if (keys.some(k => k.includes('sign') || k === 'w_rid' || k.includes('token'))) {
      indicators.push('signature');
    }
  }
  // Check URL for common auth patterns
  if (url.includes('/wbi/') || url.includes('w_rid=')) indicators.push('signature');
  if (url.includes('bearer') || url.includes('access_token')) indicators.push('bearer');
  return indicators;
}

/**
 * Recursively find the best array of item objects in a response body.
 */
export function findArrayPath(obj: unknown, depth = 0): { path: string; items: unknown[] } | null {
  if (depth > 5 || !obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) {
    if (obj.length >= 2 && obj.some(i => i && typeof i === 'object' && !Array.isArray(i))) {
      return { path: '', items: obj };
    }
    return null;
  }
  let best: { path: string; items: unknown[] } | null = null;
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

/**
 * Infer a human-readable capability name from a URL.
 */
export function inferCapabilityName(url: string): string {
  const u = url.toLowerCase();
  if (u.includes('hot') || u.includes('popular') || u.includes('ranking') || u.includes('trending')) return 'hot';
  if (u.includes('search')) return 'search';
  if (u.includes('feed') || u.includes('timeline') || u.includes('dynamic')) return 'feed';
  if (u.includes('comment') || u.includes('reply')) return 'comments';
  if (u.includes('history')) return 'history';
  if (u.includes('profile') || u.includes('me')) return 'me';
  if (u.includes('favorite') || u.includes('collect') || u.includes('bookmark')) return 'favorite';
  try {
    const segs = new URL(url).pathname
      .split('/')
      .filter(s => s && !s.match(/^\d+$/) && !s.match(/^[0-9a-f]{8,}$/i) && !s.match(/^v\d+$/));
    if (segs.length) return segs[segs.length - 1].replace(/[^a-z0-9]/gi, '_').toLowerCase();
  } catch {}
  return 'data';
}

/**
 * Infer an authentication strategy from auth indicators.
 */
export function inferStrategy(authIndicators: string[]): string {
  if (authIndicators.includes('signature')) return 'intercept';
  if (authIndicators.includes('bearer') || authIndicators.includes('csrf')) return 'header';
  return 'cookie';
}

/**
 * Score a captured request based on response structure and URL patterns.
 */
export function scoreRequest(
  req: RecordedRequest,
  arrayResult: ReturnType<typeof findArrayPath> | null,
): number {
  let s = 0;
  if (arrayResult) {
    s += 10;
    s += Math.min(arrayResult.items.length, 10);
    // Bonus for detected semantic fields
    const sample = arrayResult.items[0];
    if (sample && typeof sample === 'object') {
      const keys = Object.keys(sample as object).map(k => k.toLowerCase());
      for (const aliases of Object.values(FIELD_ROLES)) {
        if (aliases.some(a => keys.includes(a))) s += 2;
      }
    }
  }
  if (req.url.includes('/api/')) s += 3;
  // Penalize likely tracking / analytics endpoints
  if (req.url.match(/\/(track|log|analytics|beacon|pixel|stats|metric)/i)) s -= 10;
  if (req.url.match(/\/(ping|heartbeat|keep.?alive)/i)) s -= 10;
  return s;
}
