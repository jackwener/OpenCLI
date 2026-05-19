/**
 * LinkedIn Learning search via the public learning-api REST endpoint.
 * Shares cookie session with linkedin.com; no Commercial Use Limit.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const DOMAIN = 'www.linkedin.com';
const MAX_LIMIT = 50;

function normalizeWhitespace(value) {
    return String(value ?? '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseLimit(value) {
    if (value === undefined || value === null || value === '') return 10;
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
        throw new ArgumentError(`--limit must be an integer between 1 and ${MAX_LIMIT}`);
    }
    return limit;
}

function unwrapEvaluateResult(payload) {
    if (payload && typeof payload === 'object' && 'data' in payload && 'session' in payload) return payload.data;
    return payload;
}

function buildFetchScript(url, csrf) {
    return String.raw`(async () => {
    try {
      const res = await fetch(${JSON.stringify(url)}, {
        credentials: 'include',
        headers: {
          'csrf-token': ${JSON.stringify(csrf)},
          'x-restli-protocol-version': '2.0.0',
          accept: 'application/json',
        },
      });
      if (res.status === 401 || res.status === 403) return { authRequired: true, status: res.status };
      if (!res.ok) return { error: 'HTTP ' + res.status };
      return { json: await res.json() };
    } catch (e) {
      return { error: 'fetch failed: ' + ((e && e.message) || String(e)) };
    }
  })()`;
}

function parseAuthors(authors) {
    if (!Array.isArray(authors)) return '';
    return authors
        .map((a) => normalizeWhitespace((a?.firstName ?? '') + ' ' + (a?.lastName ?? '')))
        .filter(Boolean)
        .join(', ');
}

function durationSeconds(length) {
    const ts = length?.['com.linkedin.common.TimeSpan'];
    if (!ts || ts.unit !== 'SECOND') return '';
    return String(ts.duration ?? '');
}

function averageRating(rating) {
    if (!rating) return '';
    if (typeof rating.averageRating === 'number') return rating.averageRating.toFixed(2);
    if (typeof rating.ratingSum === 'number' && typeof rating.ratingCount === 'number' && rating.ratingCount > 0) {
        return (rating.ratingSum / rating.ratingCount).toFixed(2);
    }
    return '';
}

function parseRow(el, rank) {
    const type = el?.entityType || '';
    const slug = el?.slug || '';
    if (!slug) return null;
    return {
        rank,
        type,
        title: el?.headline?.title?.text || '',
        instructor: parseAuthors(el?.authors),
        difficulty: el?.difficultyLevel || '',
        duration_sec: durationSeconds(el?.length),
        rating: averageRating(el?.rating),
        rating_count: el?.rating?.ratingCount ?? '',
        viewers: el?.viewerCount ?? '',
        url: slug ? `https://www.linkedin.com/learning/${slug}` : '',
    };
}

cli({
    site: 'linkedin-learning',
    name: 'search',
    access: 'read',
    description: 'Search LinkedIn Learning courses, videos, and learning paths by keyword',
    domain: DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'keywords', type: 'string', required: true, positional: true, help: 'Search keywords, e.g. "AI agent"' },
        { name: 'limit', type: 'int', default: 10, help: `Maximum results to return (1-${MAX_LIMIT})` },
    ],
    columns: ['rank', 'type', 'title', 'instructor', 'difficulty', 'duration_sec', 'rating', 'rating_count', 'viewers', 'url'],
    func: async (page, args) => {
        if (!page) throw new CommandExecutionError('Browser session required for linkedin-learning search');
        const keywords = normalizeWhitespace(args.keywords);
        if (!keywords) throw new ArgumentError('--keywords is required');
        const limit = parseLimit(args.limit);

        await page.goto('https://www.linkedin.com/learning/');
        await page.wait(3);

        const cookies = await page.getCookies({ url: 'https://www.linkedin.com' });
        const jsession = cookies.find((c) => c.name === 'JSESSIONID')?.value;
        if (!jsession) {
            throw new AuthRequiredError(DOMAIN, 'LinkedIn JSESSIONID cookie not found. Please sign in to LinkedIn in the browser.');
        }
        const csrf = jsession.replace(/^"|"$/g, '');

        const url = `https://www.linkedin.com/learning-api/searchV2?keywords=${encodeURIComponent(keywords)}&q=keywords`;
        const result = unwrapEvaluateResult(await page.evaluate(buildFetchScript(url, csrf)));
        if (result?.authRequired) {
            throw new AuthRequiredError(DOMAIN, `LinkedIn Learning auth failed (HTTP ${result.status ?? ''}).`);
        }
        if (!result?.json) {
            throw new CommandExecutionError(`LinkedIn Learning searchV2 failed: ${result?.error ?? 'no payload'}`);
        }
        const elements = result.json?.elements;
        if (!Array.isArray(elements)) {
            throw new CommandExecutionError('LinkedIn Learning searchV2 returned malformed payload: missing elements array');
        }
        if (elements.length === 0) {
            throw new EmptyResultError(`No LinkedIn Learning results for "${keywords}"`);
        }
        const rows = [];
        for (const el of elements) {
            if (rows.length >= limit) break;
            const row = parseRow(el, rows.length + 1);
            if (row) rows.push(row);
        }
        if (rows.length === 0) {
            throw new CommandExecutionError('LinkedIn Learning searchV2 returned no parseable rows with slug identity');
        }
        return rows;
    },
});

export const __test__ = {
    normalizeWhitespace,
    parseLimit,
    parseAuthors,
    durationSeconds,
    averageRating,
    parseRow,
    buildFetchScript,
};
