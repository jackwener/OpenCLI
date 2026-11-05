// Shared Reddit JSON fetch path. Every read command fetches Reddit's `.json`
// endpoints from inside the logged-in page, and Reddit answers those requests
// with several different non-JSON pages that must not be confused:
//   - its "You've been blocked by network security" page (HTTP 403, HTML),
//     which is applied per endpoint and network and is not fixed by logging in
//     again (#2720, #2771);
//   - a rate-limit response (HTTP 429);
//   - other HTML (login / challenge pages).
// `redditFetchJson` runs in the page (embed it with `.toString()`; it must stay
// self-contained) and returns `{ ok: true, data }` or `{ ok: false, failure }`.
// `throwRedditFetchFailure` turns a failure into a typed error on the Node side.
// The post-media helpers below are shared by the listing commands.
import { AuthRequiredError, CliError, CommandExecutionError, EmptyResultError, EXIT_CODES } from '@jackwener/opencli/errors';
import { throwIfLoginWall } from '@jackwener/opencli/utils';

export async function redditFetchJson(path, init) {
    const response = await fetch(path, { credentials: 'include', ...(init || {}) });
    const contentType = (response.headers && response.headers.get('content-type')) || '';
    const text = await response.text();
    const status = response.status;
    const url = response.url || path;
    const trimmed = text.replace(/^\s+/, '');
    const isHtml = /text\/html/i.test(contentType) || trimmed.startsWith('<');
    if (isHtml && /blocked by network security/i.test(text)) {
        return { ok: false, failure: { reason: 'blocked', status, url } };
    }
    if (status === 429) return { ok: false, failure: { reason: 'rate-limited', status, url } };
    if (isHtml) {
        return { ok: false, failure: { reason: 'html', status, url, contentType, bodyPreview: trimmed.slice(0, 100) } };
    }
    let data;
    try {
        data = JSON.parse(text);
    } catch (error) {
        if (!response.ok) return { ok: false, failure: { reason: 'http', status, url } };
        return { ok: false, failure: { reason: 'malformed', status, url, detail: String(error && error.message || error) } };
    }
    if (!response.ok) {
        const apiReason = data && typeof data.reason === 'string' ? data.reason : '';
        return { ok: false, failure: { reason: 'http', status, url, apiReason } };
    }
    return { ok: true, data };
}

export const REDDIT_SECURITY_BLOCK_HINT = 'Reddit\'s network-security filter rejected this request. This is not an expired login: '
    + 'if `opencli reddit whoami` works, logging in again will not help. Reddit applies the block per endpoint and network; '
    + 'wait and retry later, or retry from a different network. The request was not retried.';

/** Throw the typed error for a `redditFetchJson` failure. `label` names the
 * request in the message (defaults to the failing URL). */
export function throwRedditFetchFailure(failure, label) {
    const where = label || failure?.url || 'Reddit request';
    const status = failure?.status;
    switch (failure?.reason) {
        case 'blocked':
            throw new CliError(
                'SECURITY_BLOCK',
                `Reddit blocked ${where} with its "blocked by network security" page (HTTP ${status}).`,
                REDDIT_SECURITY_BLOCK_HINT,
            );
        case 'rate-limited':
            throw new CliError(
                'RATE_LIMITED',
                `Reddit rate limited ${where} (HTTP 429).`,
                'Wait before making another request; the request was not retried.',
                EXIT_CODES.TEMPFAIL,
            );
        case 'html':
            throwIfLoginWall({
                __loginWall: true,
                status,
                url: failure.url || '',
                contentType: failure.contentType || '',
                bodyPreview: failure.bodyPreview || '',
            }, { url: where });
            break;
        case 'http': {
            const detail = `Reddit ${where} returned HTTP ${status}${failure.apiReason ? ` (${failure.apiReason})` : ''}`;
            if (status === 401 || status === 403) throw new AuthRequiredError('reddit.com', detail);
            if (status === 404) throw new EmptyResultError(where, `${detail}.`);
            throw new CommandExecutionError(`${detail}.`);
        }
        case 'malformed':
            throw new CommandExecutionError(`Reddit ${where} returned invalid JSON: ${failure.detail}`);
        case 'exception':
            throw new CommandExecutionError(`Reddit request ${where} failed: ${failure.detail}`);
    }
    throw new CommandExecutionError(`Unexpected Reddit fetch failure for ${where}: ${JSON.stringify(failure)}`);
}

export function unwrapEvaluateResult(payload) {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)
        && 'session' in payload && 'data' in payload) {
        return payload.data;
    }
    return payload;
}

/** Fetch one Reddit JSON endpoint from the current page and return its body,
 * or throw the typed error for the failure. */
export async function fetchRedditJson(page, path, label = path) {
    const result = unwrapEvaluateResult(await page.evaluate(`(async () => {
      const redditFetchJson = ${redditFetchJson.toString()};
      try {
        return await redditFetchJson(${JSON.stringify(path)});
      } catch (error) {
        return { ok: false, failure: { reason: 'exception', detail: String(error && error.message || error) } };
      }
    })()`));
    if (!result || result.ok !== true) throwRedditFetchFailure(result?.failure, label);
    return result.data;
}

/** Fetch a Reddit Listing endpoint and return `data.children`. */
export async function fetchRedditListing(page, path, label = path) {
    const payload = await fetchRedditJson(page, path, label);
    const children = payload?.data?.children;
    if (!Array.isArray(children)) {
        throw new CommandExecutionError(`Reddit ${label} returned a malformed listing (missing data.children).`);
    }
    return children;
}

export function decodeRedditHtml(value) {
    if (typeof value !== 'string' || !value) return '';
    return value
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/gi, "'")
        .replace(/&#39;/g, "'");
}

export function extractRedditMedia(d) {
    const galleryUrls = [];
    const items = d?.gallery_data?.items;
    const meta = d?.media_metadata;
    if (Array.isArray(items) && meta && typeof meta === 'object') {
        for (const item of items) {
            const url = meta[item?.media_id]?.s?.u;
            if (typeof url === 'string' && url) galleryUrls.push(decodeRedditHtml(url));
        }
    }
    return {
        post_hint: typeof d?.post_hint === 'string' ? d.post_hint : '',
        url_overridden_by_dest: decodeRedditHtml(d?.url_overridden_by_dest || ''),
        preview_image_url: decodeRedditHtml(d?.preview?.images?.[0]?.source?.url || ''),
        gallery_urls: galleryUrls,
    };
}
