/**
 * Pixiv shared helpers: authenticated Ajax fetch with standard error handling.
 *
 * All Pixiv Ajax APIs return `{ error: false, body: ... }` on success.
 * On failure the HTTP status code is used to distinguish auth (401/403),
 * not-found (404), and other errors.
 */

import type { IPage } from '../../types.js';
import { AuthRequiredError, CommandExecutionError } from '../../errors.js';

const PIXIV_DOMAIN = 'www.pixiv.net';

/**
 * Navigate to Pixiv (to attach cookies) then fetch a Pixiv Ajax API endpoint.
 *
 * Handles the common navigate → evaluate(fetch) → error-check pattern used
 * by every Pixiv TS adapter.
 *
 * @param page  - Browser page instance
 * @param path  - API path, e.g. '/ajax/illust/12345'
 * @param opts  - Optional query params
 * @returns     - The parsed `body` from the JSON response
 * @throws AuthRequiredError on 401/403
 * @throws CommandExecutionError on 404 or other HTTP errors
 */
export async function pixivFetch(
  page: IPage,
  path: string,
  opts: { params?: Record<string, string | number>; notFoundMsg?: string } = {},
): Promise<any> {
  await page.goto(`https://${PIXIV_DOMAIN}`);

  const qs = opts.params
    ? '?' + Object.entries(opts.params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
    : '';
  const url = `https://${PIXIV_DOMAIN}${path}${qs}`;

  const data: any = await page.evaluate(`
    (async () => {
      const res = await fetch(${JSON.stringify(url)}, { credentials: 'include' });
      if (!res.ok) return { __httpError: res.status };
      return await res.json();
    })()
  `);

  if (data?.__httpError) {
    const status = data.__httpError;
    if (status === 401 || status === 403) {
      throw new AuthRequiredError(PIXIV_DOMAIN, 'Authentication required — please log in to Pixiv in Chrome');
    }
    if (status === 404) {
      throw new CommandExecutionError(opts.notFoundMsg || `Pixiv resource not found (HTTP 404)`);
    }
    throw new CommandExecutionError(`Pixiv request failed (HTTP ${status})`);
  }

  return data?.body;
}

/** Maximum number of illust IDs per batch detail request (Pixiv server limit). */
export const BATCH_SIZE = 48;
