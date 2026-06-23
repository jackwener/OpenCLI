/**
 * Pixiv shared helpers: authenticated Ajax fetch with standard error handling.
 *
 * All Pixiv Ajax APIs return `{ error: false, body: ... }` on success.
 * On failure the HTTP status code is used to distinguish auth (401/403),
 * not-found (404), and other errors.
 */
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
const PIXIV_DOMAIN = 'www.pixiv.net';

function unwrapEvaluateResult(payload) {
    if (payload && !Array.isArray(payload) && typeof payload === 'object' && 'session' in payload && 'data' in payload) {
        return payload.data;
    }
    return payload;
}

function extractPixivErrorMessage(payload) {
    if (!payload || typeof payload !== 'object') return '';
    const candidates = [
        payload.message,
        payload.errorMessage,
        payload.error?.message,
        payload.error,
    ];
    const found = candidates.find((value) => typeof value === 'string' && value.trim());
    return found ? found.trim() : '';
}
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
export async function pixivFetch(page, path, opts = {}) {
    try {
        await page.goto(`https://${PIXIV_DOMAIN}`);
    } catch (error) {
        throw new CommandExecutionError(`Pixiv navigation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const qs = opts.params
        ? '?' + Object.entries(opts.params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
        : '';
    const url = `https://${PIXIV_DOMAIN}${path}${qs}`;
    let data;
    try {
        data = unwrapEvaluateResult(await page.evaluate(`
    (async () => {
      const res = await fetch(${JSON.stringify(url)}, { credentials: 'include' });
      const text = await res.text();
      let json = null;
      if (text) {
        try { json = JSON.parse(text); } catch {}
      }
      if (!res.ok) {
        return {
          __httpError: res.status,
          message: json?.message || json?.errorMessage || json?.error?.message || (typeof json?.error === 'string' ? json.error : '') || text.slice(0, 200),
        };
      }
      if (!json) return { __malformed: true, message: 'invalid JSON' };
      return json;
    })()
  `));
    } catch (error) {
        throw new CommandExecutionError(`Pixiv request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (data?.__httpError) {
        const status = data.__httpError;
        if (status === 401 || status === 403) {
            throw new AuthRequiredError(PIXIV_DOMAIN, 'Authentication required — please log in to Pixiv in Chrome');
        }
        const message = extractPixivErrorMessage(data);
        if (status === 404) {
            throw new CommandExecutionError(message || opts.notFoundMsg || `Pixiv resource not found (HTTP 404)`);
        }
        throw new CommandExecutionError(message ? `Pixiv request failed (HTTP ${status}): ${message}` : `Pixiv request failed (HTTP ${status})`);
    }
    if (!data || Array.isArray(data) || typeof data !== 'object' || data.__malformed) {
        throw new CommandExecutionError('Pixiv request returned malformed JSON payload');
    }
    if (data.error === true) {
        throw new CommandExecutionError(extractPixivErrorMessage(data) || 'Pixiv API returned an error');
    }
    if (!('body' in data)) {
        throw new CommandExecutionError('Pixiv request returned malformed API payload');
    }
    return data?.body;
}
/** Maximum number of illust IDs per batch detail request (Pixiv server limit). */
export const BATCH_SIZE = 48;
