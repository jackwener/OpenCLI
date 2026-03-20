/**
 * Wikipedia adapter utilities.
 *
 * Uses the public MediaWiki REST API and Action API — no key required.
 * REST API: https://en.wikipedia.org/api/rest_v1/
 * Action API: https://en.wikipedia.org/w/api.php
 */

import { CliError } from '../../errors.js';

export async function wikiFetch(lang: string, path: string): Promise<any> {
  const url = `https://${lang}.wikipedia.org${path}`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'opencli/1.0 (https://github.com/jackwener/opencli)' },
  });
  if (!resp.ok) {
    throw new CliError('FETCH_ERROR', `Wikipedia API HTTP ${resp.status}`, `Check your title or search term`);
  }
  return resp.json();
}
