import { cli, Strategy } from '@jackwener/opencli/registry';
import { fetchWebApi, WEREAD_UA, WEREAD_WEB_ORIGIN } from './utils.js';
function decodeHtmlText(value) {
    return value
        .replace(/<[^>]+>/g, '')
        .replace(/&#x([0-9a-fA-F]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .trim();
}
function normalizeSearchTitle(value) {
    return value.replace(/\s+/g, ' ').trim();
}
function buildSearchIdentity(title, author) {
    return `${normalizeSearchTitle(title)}\u0000${normalizeSearchTitle(author)}`;
}
function countSearchTitles(entries) {
    const counts = new Map();
    for (const entry of entries) {
        const key = normalizeSearchTitle(entry.title);
        if (!key)
            continue;
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
}
function countSearchIdentities(entries) {
    const counts = new Map();
    for (const entry of entries) {
        const key = buildSearchIdentity(entry.title, entry.author);
        if (!normalizeSearchTitle(entry.title) || !normalizeSearchTitle(entry.author))
            continue;
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
}
function isUniqueCount(counts, key) {
    return (counts.get(key) || 0) <= 1;
}
/**
 * Build exact and title-only queues separately.
 * Exact title+author matches are preferred; title-only matching is used only
 * when the HTML card did not expose an author field.
 */
function buildSearchUrlQueues(entries) {
    const exactQueues = new Map();
    const titleOnlyQueues = new Map();
    for (const entry of entries) {
        const titleKey = normalizeSearchTitle(entry.title);
        if (!titleKey || !entry.url)
            continue;
        const queueMap = entry.author ? exactQueues : titleOnlyQueues;
        const queueKey = entry.author ? buildSearchIdentity(entry.title, entry.author) : titleKey;
        const current = queueMap.get(queueKey);
        if (current) {
            current.push(entry.url);
            continue;
        }
        queueMap.set(queueKey, [entry.url]);
    }
    return { exactQueues, titleOnlyQueues };
}
function resolveSearchResultUrl(params) {
    const { exactQueues, titleOnlyQueues, apiIdentityCounts, htmlIdentityCounts, apiTitleCounts, htmlTitleCounts, title, author, } = params;
    const identityKey = buildSearchIdentity(title, author);
    if (isUniqueCount(apiIdentityCounts, identityKey) && isUniqueCount(htmlIdentityCounts, identityKey)) {
        const exactUrl = exactQueues.get(identityKey)?.shift();
        if (exactUrl)
            return exactUrl;
    }
    const titleKey = normalizeSearchTitle(title);
    if (!isUniqueCount(apiTitleCounts, titleKey) || !isUniqueCount(htmlTitleCounts, titleKey)) {
        return '';
    }
    return titleOnlyQueues.get(titleKey)?.shift() ?? '';
}
/**
 * Extract rendered search result reader URLs from the server-rendered search page.
 * The public JSON API still returns bookId, but the current web app links results
 * through /web/reader/<opaque-id> rather than /web/bookDetail/<bookId>.
 */
async function loadSearchHtmlEntries(query) {
    const url = new URL('/web/search/books', WEREAD_WEB_ORIGIN);
    url.searchParams.set('keyword', query);
    let html = '';
    try {
        const resp = await fetch(url.toString(), {
            headers: { 'User-Agent': WEREAD_UA },
        });
        if (!resp.ok)
            return [];
        html = await resp.text();
    }
    catch {
        return [];
    }
    const items = Array.from(html.matchAll(/<li[^>]*class="wr_bookList_item"[^>]*>([\s\S]*?)<\/li>/g));
    return items.map((match) => {
        const chunk = match[1];
        const hrefMatch = chunk.match(/<a[^>]*href="([^"]+)"[^>]*class="wr_bookList_item_link"[^>]*>|<a[^>]*class="wr_bookList_item_link"[^>]*href="([^"]+)"[^>]*>/);
        const titleMatch = chunk.match(/<p[^>]*class="wr_bookList_item_title"[^>]*>([\s\S]*?)<\/p>/);
        const authorMatch = chunk.match(/<p[^>]*class="wr_bookList_item_author"[^>]*>([\s\S]*?)<\/p>/);
        const href = hrefMatch?.[1] || hrefMatch?.[2] || '';
        const title = decodeHtmlText(titleMatch?.[1] || '');
        const author = decodeHtmlText(authorMatch?.[1] || '');
        return {
            author,
            url: href ? new URL(href, WEREAD_WEB_ORIGIN).toString() : '',
            title,
        };
    }).filter((item) => item.url && item.title);
}
cli({
    site: 'weread',
    name: 'search',
    access: 'read',
    description: 'Search books on WeRead',
    domain: 'weread.qq.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search keyword' },
        { name: 'limit', type: 'int', default: 10, help: 'Max results' },
    ],
    columns: ['rank', 'title', 'author', 'bookId', 'url'],
    func: async (args) => {
        const [data, htmlEntries] = await Promise.all([
            fetchWebApi('/search/global', { keyword: args.query }),
            loadSearchHtmlEntries(String(args.query ?? '')),
        ]);
        const books = data?.books ?? [];
        const { exactQueues, titleOnlyQueues } = buildSearchUrlQueues(htmlEntries);
        const apiIdentityCounts = countSearchIdentities(books.map((item) => ({
            title: item.bookInfo?.title ?? '',
            author: item.bookInfo?.author ?? '',
        })));
        const htmlIdentityCounts = countSearchIdentities(htmlEntries.filter((entry) => entry.author));
        const apiTitleCounts = countSearchTitles(books.map((item) => ({ title: item.bookInfo?.title ?? '' })));
        const htmlTitleCounts = countSearchTitles(htmlEntries);
        return books.slice(0, Number(args.limit)).map((item, i) => {
            const title = item.bookInfo?.title ?? '';
            const author = item.bookInfo?.author ?? '';
            return {
                rank: i + 1,
                title,
                author,
                bookId: item.bookInfo?.bookId ?? '',
                url: resolveSearchResultUrl({
                    exactQueues,
                    titleOnlyQueues,
                    apiIdentityCounts,
                    htmlIdentityCounts,
                    apiTitleCounts,
                    htmlTitleCounts,
                    title,
                    author,
                }),
            };
        });
    },
});
