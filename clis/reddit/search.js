import { readRedditListing, unwrapEvaluateResult } from './listing-result.js';
import { fetchRankedRedditSearch } from './web-search.js';
import { log } from '@jackwener/opencli/logger';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { BROWSER_JSON_SNIFF_FN, throwIfLoginWall } from '@jackwener/opencli/utils';
import { cli, Strategy } from '@jackwener/opencli/registry';

function buildRedditSearchPath(kwargs) {
    const query = String(kwargs.query ?? '');
    const subreddit = String(kwargs.subreddit ?? '').trim();
    const sort = String(kwargs.sort ?? 'relevance');
    const time = String(kwargs.time ?? 'all');
    const limit = Number(kwargs.limit ?? 15);
    const basePath = subreddit
        ? `/r/${encodeURIComponent(subreddit)}/search.json`
        : '/search.json';
    const params = new URLSearchParams({
        q: query,
        sort,
        t: time,
        limit: String(limit),
        restrict_sr: subreddit ? 'on' : 'off',
        raw_json: '1',
    });
    return `${basePath}?${params.toString()}`;
}


function decodeHtml(value) {
    if (typeof value !== 'string' || !value) return '';
    return value
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/gi, "'")
        .replace(/&#39;/g, "'");
}

function mapRedditSearchRow(child, index) {
    const item = child?.data;
    if (!item || typeof item !== 'object') {
        throw new CommandExecutionError(`Reddit search row ${index + 1} was missing data.`);
    }
    const preview = item.preview?.images?.[0]?.source?.url || '';
    const gallery = [];
    const galleryItems = item.gallery_data?.items;
    const media = item.media_metadata;
    if (Array.isArray(galleryItems) && media) {
        for (const entry of galleryItems) {
            const source = media[entry?.media_id]?.s;
            if (source?.u) gallery.push(decodeHtml(source.u));
        }
    }
    return {
        id: item.id || '',
        title: item.title || '',
        subreddit: item.subreddit_name_prefixed || '',
        author: item.author || '',
        score: item.score || 0,
        comments: item.num_comments || 0,
        url: item.permalink ? `https://www.reddit.com${item.permalink}` : '',
        created_utc: item.created_utc || 0,
        selftext: item.selftext || '',
        post_hint: item.post_hint || '',
        url_overridden_by_dest: decodeHtml(item.url_overridden_by_dest || ''),
        preview_image_url: decodeHtml(preview),
        gallery_urls: gallery,
    };
}

function mapSearchResult(result) {
    return readRedditListing(result, 'Reddit search').map(mapRedditSearchRow);
}

cli({
    site: 'reddit',
    name: 'search',
    access: 'read',
    description: 'Search Reddit Posts',
    domain: 'www.reddit.com',
    navigateBefore: false,
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'query', type: 'string', required: true, positional: true, help: 'Reddit search query' },
        { name: 'subreddit', type: 'string', default: '', help: 'Search within a specific subreddit' },
        { name: 'sort', type: 'string', default: 'relevance', help: 'Sort order: relevance, hot, top, new, comments' },
        { name: 'time', type: 'string', default: 'all', help: 'Time filter: hour, day, week, month, year, all' },
        { name: 'limit', type: 'int', default: 15 },
    ],
    columns: ['id', 'title', 'subreddit', 'author', 'score', 'comments', 'url', 'created_utc', 'selftext', 'post_hint', 'url_overridden_by_dest', 'preview_image_url', 'gallery_urls'],
    func: async (page, kwargs) => {
        if (!page) throw new CommandExecutionError('Browser session required for Reddit search');
        const limit = Number(kwargs.limit ?? 15);
        if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new ArgumentError('Reddit search limit must be an integer from 1 to 1000.');
        await page.goto('https://www.reddit.com');
        const requestPath = buildRedditSearchPath(kwargs);
        const rawResult = await page.evaluate(`(async () => {
      ${BROWSER_JSON_SNIFF_FN}
      try {
        const fetchRankedRedditSearch = ${fetchRankedRedditSearch.toString()};
        return await fetchRankedRedditSearch(${JSON.stringify(String(kwargs.query ?? ''))}, ${JSON.stringify(String(kwargs.subreddit ?? '').trim())}, ${JSON.stringify(String(kwargs.sort ?? 'relevance'))}, ${JSON.stringify(String(kwargs.time ?? 'all'))}, ${limit}, ${JSON.stringify(requestPath)});
      } catch (error) {
        return { kind: 'exception', detail: String(error?.message || error) };
      }
    })()`);
        const result = unwrapEvaluateResult(rawResult);
        if (result?.kind === 'login-wall') {
            throwIfLoginWall(result.sentinel, { url: requestPath });
        }
        const rows = mapSearchResult(result).slice(0, limit);
        if (result.fallback) log.warn('Reddit web-search markup was unavailable; using legacy search ranking.');
        if (result.missing) log.warn(`Reddit did not return details for ${result.missing} ranked posts; preserving the remaining web-search order.`);
        if (result.capped) log.warn('Reddit search reached its 10-page pagination limit.');
        return rows;
    },
});

export const __test__ = {
    buildRedditSearchPath,
    mapSearchResult,
    unwrapEvaluateResult,
};
