/**
 * Pixiv shared helpers: authenticated Ajax fetch with standard error handling.
 *
 * All Pixiv Ajax APIs return `{ error: false, body: ... }` on success.
 * On failure the HTTP status code is used to distinguish auth (401/403),
 * not-found (404), and other errors.
 */
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
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

export function normalizePixivPositiveInteger(value, defaultValue, label, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
    const raw = value ?? defaultValue;
    const numberValue = Number(raw);
    if (!Number.isInteger(numberValue)) {
        throw new ArgumentError(`${label} must be an integer`);
    }
    if (numberValue < min) {
        throw new ArgumentError(`${label} must be >= ${min}`);
    }
    if (numberValue > max) {
        throw new ArgumentError(`${label} must be <= ${max}`);
    }
    return numberValue;
}

export function normalizePixivNonNegativeInteger(value, defaultValue, label, { max = Number.MAX_SAFE_INTEGER } = {}) {
    return normalizePixivPositiveInteger(value, defaultValue, label, { min: 0, max });
}

export function requirePixivPayloadObject(value, label) {
    if (!value || Array.isArray(value) || typeof value !== 'object') {
        throw new CommandExecutionError(`${label} returned malformed payload`);
    }
    return value;
}

export function requirePixivId(value, label) {
    const id = String(value ?? '').trim();
    if (!/^\d+$/.test(id)) {
        throw new CommandExecutionError(`${label} returned malformed Pixiv ID`);
    }
    return id;
}

export function requirePixivString(value, label) {
    const text = String(value ?? '').trim();
    if (!text) {
        throw new CommandExecutionError(`${label} returned malformed text field`);
    }
    return text;
}

export function normalizePixivUserData(raw) {
    if (!raw || Array.isArray(raw) || typeof raw !== 'object') {
        return null;
    }
    const id = String(raw.id ?? raw.userId ?? raw.user_id ?? '').trim();
    const name = String(raw.name ?? raw.userName ?? raw.user_name ?? '').trim();
    if (!/^\d+$/.test(id)) {
        return null;
    }
    return {
        id,
        name,
        premium: Boolean(raw.premium ?? raw.isPremium ?? raw.is_premium ?? false),
        profileImageUrl: String(raw.profileImageUrl ?? raw.imageBig ?? raw.image ?? raw.avatar ?? '').trim(),
    };
}

export async function getCurrentPixivUser(page) {
    try {
        await page.goto(`https://${PIXIV_DOMAIN}`);
    } catch (error) {
        throw new CommandExecutionError(`Pixiv navigation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    let data;
    try {
        data = unwrapEvaluateResult(await page.evaluate(`
    (() => {
      const candidates = [
        globalThis?.pixiv?.context?.userData,
        globalThis?.pixiv?.user,
        globalThis?.globalInitData?.userData,
        globalThis?.globalInitData?.user,
        globalThis?.__PIXIV_CONTEXT__?.userData,
      ];
      for (const value of candidates) {
        if (value && typeof value === 'object') return value;
      }
      const meta = document.querySelector('meta[name="global-data"]')?.content;
      if (meta) {
        try {
          const parsed = JSON.parse(meta);
          if (parsed?.userData) return parsed.userData;
          if (parsed?.user) return parsed.user;
        } catch {}
      }
      const userLink = Array.from(document.querySelectorAll('a[href]'))
        .map((node) => {
          try {
            const url = new URL(node.getAttribute('href'), location.href);
            const pathname = url.pathname;
            if (!pathname.startsWith('/users/')) return null;
            const id = pathname.slice('/users/'.length);
            if (!id || !Array.from(id).every((ch) => ch >= '0' && ch <= '9')) return null;
            return {
              id,
              name: node.textContent?.trim() || '',
              profileImageUrl: node.querySelector('img')?.src || '',
            };
          } catch {
            return null;
          }
        })
        .find(Boolean);
      if (userLink) return userLink;
      return null;
    })()
  `));
    } catch (error) {
        throw new CommandExecutionError(`Pixiv current-account lookup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const user = normalizePixivUserData(data);
    if (!user) {
        throw new AuthRequiredError(PIXIV_DOMAIN, 'Authentication required — please log in to Pixiv in Chrome');
    }
    return user;
}
