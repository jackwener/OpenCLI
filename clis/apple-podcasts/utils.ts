/**
 * Shared Apple Podcasts utilities.
 *
 * Uses the public iTunes Search API — no API key required.
 * https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/
 */

import { CliError } from '@jackwener/opencli/errors';

const BASE = 'https://itunes.apple.com';

export async function itunesFetch(path: string): Promise<any> {
  const resp = await fetch(`${BASE}${path}`);
  if (!resp.ok) {
    throw new CliError(
      'FETCH_ERROR',
      `iTunes API HTTP ${resp.status}`,
      'Check your search term or podcast ID',
    );
  }
  return resp.json();
}

/** Format milliseconds to mm:ss. Returns '-' for missing input. */
export function formatDuration(ms: number): string {
  if (!ms || !Number.isFinite(ms)) return '-';
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Format ISO date string to YYYY-MM-DD. Returns '-' for missing input. */
export function formatDate(iso: string): string {
  if (!iso) return '-';
  return iso.slice(0, 10);
}
