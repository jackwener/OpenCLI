import { AuthRequiredError, CliError } from '@jackwener/opencli/errors';

export const MAX_LIMIT = 1000;

export function validateLimit(raw, fallback = 20) {
    const limit = Number(raw ?? fallback);
    if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_LIMIT) {
        throw new CliError('INVALID_INPUT', `Limit must be a positive integer no greater than ${MAX_LIMIT}`, 'Use a normal-sized limit to avoid slow requests or Zhihu risk controls');
    }
    return limit;
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
        const data = await page.evaluate(`
      (async () => {
        const r = await fetch(${JSON.stringify(url)}, { credentials: 'include' });
        if (!r.ok) return { __httpError: r.status };
        return await r.json();
      })()
    `);
        if (!data || data.__httpError) {
            const status = data?.__httpError;
            if (status === 401 || status === 403) {
                throw new AuthRequiredError('www.zhihu.com', `Failed to fetch Zhihu ${label}`);
            }
            if (status === 404) {
                throw new CliError('NOT_FOUND', `Zhihu ${label} not found`, 'Check the target identifier');
            }
            throw new CliError('FETCH_ERROR', status ? `Zhihu ${label} request failed (HTTP ${status})` : `Zhihu ${label} request failed`, 'Try again later or rerun with -v');
        }
        for (const item of data.data || []) {
            items.push(item);
            if (items.length >= limit) break;
        }
        if (data.paging?.is_end) break;
        url = typeof data.paging?.next === 'string' ? data.paging.next : '';
    }
    return items;
}
