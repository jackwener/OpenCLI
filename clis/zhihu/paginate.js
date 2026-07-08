import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const MAX_LIMIT = 1000;

export function validateLimit(raw, fallback = 20) {
    const value = raw ?? fallback;
    let limit;
    if (typeof value === 'number') {
        limit = value;
    }
    else {
        const text = String(value).trim();
        if (!/^\d+$/.test(text)) {
            throw new ArgumentError(`--limit must be a positive integer no greater than ${MAX_LIMIT}`, 'Use a normal-sized decimal integer limit to avoid slow requests or Zhihu risk controls');
        }
        limit = Number(text);
    }
    if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_LIMIT) {
        throw new ArgumentError(`--limit must be a positive integer no greater than ${MAX_LIMIT}`, 'Use a normal-sized decimal integer limit to avoid slow requests or Zhihu risk controls');
    }
    return limit;
}

export function unwrapEvaluateResult(payload) {
    if (payload && typeof payload === 'object' && 'data' in payload && 'session' in payload) return payload.data;
    return payload;
}

export function requireZhihuListPayload(payload, label, url) {
    const data = unwrapEvaluateResult(payload);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new CommandExecutionError(`Zhihu ${label} returned malformed payload`, `URL: ${url}`);
    }
    if (data.__httpError) {
        const status = data.__httpError;
        if (status === 401 || status === 403) {
            throw new AuthRequiredError('www.zhihu.com', `Failed to fetch Zhihu ${label}`);
        }
        if (status === 404) {
            throw new EmptyResultError(`zhihu ${label}`, 'Check the target identifier');
        }
        throw new CommandExecutionError(`Zhihu ${label} request failed${status ? ` (HTTP ${status})` : ''}`, 'Try again later or rerun with -v');
    }
    if (data.__fetchError) {
        throw new CommandExecutionError(`Zhihu ${label} request failed`, String(data.__fetchError));
    }
    if (!Array.isArray(data.data)) {
        throw new CommandExecutionError(`Zhihu ${label} returned malformed data list`, `URL: ${url}`);
    }
    if (!data.paging || typeof data.paging !== 'object') {
        throw new CommandExecutionError(`Zhihu ${label} returned malformed paging data`, `URL: ${url}`);
    }
    return data;
}

function normalizeZhihuApiUrl(value) {
    if (typeof value !== 'string' || !value) return '';
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:') return '';
        if (url.hostname === 'api.zhihu.com' && url.pathname.startsWith('/members/')) {
            return `https://www.zhihu.com/api/v4${url.pathname}${url.search}`;
        }
        if (url.hostname === 'www.zhihu.com' && url.pathname.startsWith('/api/v4/members/')) {
            return url.toString();
        }
    }
    catch {
        return '';
    }
    return '';
}

function sameZhihuApiPath(a, b) {
    try {
        return new URL(a).pathname === new URL(b).pathname;
    }
    catch {
        return false;
    }
}

/**
 * Fetch a paginated Zhihu /api/v4 list endpoint (credentialed) and collect up
 * to `limit` raw items, following `paging.next`. `label` is used in error
 * messages. Returns the raw item array; callers map it to rows.
 */
export async function fetchZhihuList(page, firstUrl, limit, label) {
    const items = [];
    const visited = new Set();
    let url = firstUrl;
    while (url && items.length < limit && !visited.has(url)) {
        visited.add(url);
        const data = requireZhihuListPayload(await page.evaluate(`
      (async () => {
        try {
          const r = await fetch(${JSON.stringify(url)}, { credentials: 'include' });
          if (!r.ok) return { __httpError: r.status };
          return await r.json();
        } catch (err) {
          return { __fetchError: err?.message || String(err) };
        }
      })()
    `), label, url);
        for (const item of data.data) {
            items.push(item);
            if (items.length >= limit) break;
        }
        if (data.paging?.is_end) break;
        const next = normalizeZhihuApiUrl(data.paging?.next);
        if (!next || !sameZhihuApiPath(next, firstUrl)) {
            throw new CommandExecutionError(`Zhihu ${label} pagination returned malformed next URL`);
        }
        if (visited.has(next)) {
            throw new CommandExecutionError(`Zhihu ${label} pagination returned a repeated next URL`);
        }
        url = next;
    }
    if (items.length === 0) {
        throw new EmptyResultError(`zhihu ${label}`, 'No rows were returned for the requested Zhihu user.');
    }
    return items;
}

export const __test__ = {
    normalizeZhihuApiUrl,
    sameZhihuApiPath,
};
