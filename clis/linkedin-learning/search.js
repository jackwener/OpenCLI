/**
 * LinkedIn Learning search via the public learning-api REST endpoint.
 * Shares cookie session with linkedin.com; no Commercial Use Limit.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { DOMAIN, MAX_LIMIT, fetchLinkedInLearningApi, normalizeWhitespace, parseLimit } from './shared.js';

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

        const url = `https://www.linkedin.com/learning-api/searchV2?keywords=${encodeURIComponent(keywords)}&q=keywords`;
        const result = await fetchLinkedInLearningApi(page, url);
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
    parseAuthors,
    durationSeconds,
    averageRating,
    parseRow,
};
