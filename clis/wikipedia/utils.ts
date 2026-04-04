/**
 * Wikipedia adapter utilities.
 *
 * Uses the public MediaWiki REST API and Action API — no key required.
 * REST API: https://en.wikipedia.org/api/rest_v1/
 * Action API: https://en.wikipedia.org/w/api.php
 */

import { CliError } from '../../src/errors.js';

/** Maximum character length for article extract fields. */
export const EXTRACT_MAX_LEN = 300;

/** Maximum character length for short description fields. */
export const DESC_MAX_LEN = 80;

/** Response shape shared by /page/summary and /page/random/summary endpoints. */
export interface WikiSummary {
  title?: string;
  description?: string;
  extract?: string;
  content_urls?: { desktop?: { page?: string } };
}

/** Article entry returned by the /feed/featured most-read endpoint. */
export interface WikiMostReadArticle {
  title?: string;
  description?: string;
  views?: number;
}

export async function wikiFetch(lang: string, path: string): Promise<unknown> {
  const url = `https://${lang}.wikipedia.org${path}`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'opencli/1.0 (https://github.com/jackwener/opencli)' },
  });
  if (!resp.ok) {
    throw new CliError('FETCH_ERROR', `Wikipedia API HTTP ${resp.status}`, `Check your title or search term`);
  }
  return resp.json();
}

/** Map a WikiSummary API response to the standard output row. */
export function formatSummaryRow(data: WikiSummary, lang: string) {
  return {
    title: data.title!,
    description: data.description ?? '-',
    extract: (data.extract ?? '').slice(0, EXTRACT_MAX_LEN),
    url: data.content_urls?.desktop?.page ?? `https://${lang}.wikipedia.org`,
  };
}
