import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { WEREAD_UA, WEREAD_WEB_ORIGIN } from './utils.js';

const MAX_LIMIT = 100;
const MAX_FRAGMENT_SIZE = 500;
const SEARCH_PAGE_SIZE = 50;

function decodeHtmlText(value) {
    return String(value || '')
        .replace(/<[^>]+>/g, '')
        .replace(/&#x([0-9a-fA-F]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .trim();
}

function normalizeSearchText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizePositiveInteger(value, defaultValue, label, maxValue) {
    const raw = value ?? defaultValue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`${label} must be a positive integer`);
    }
    if (maxValue != null && n > maxValue) {
        throw new ArgumentError(`${label} must be <= ${maxValue}`);
    }
    return n;
}

function parseOptionalFiniteNumber(value) {
    if (value == null || value === '')
        return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function parseHasMore(value) {
    if (value === true || value === 1 || value === '1')
        return true;
    if (value === false || value === 0 || value === '0')
        return false;
    return null;
}

function normalizeRequiredString(value, label) {
    const text = normalizeSearchText(value);
    if (!text) {
        throw new ArgumentError(`${label} is required`);
    }
    return text;
}

function parseWereadReaderUrl(value) {
    let url;
    try {
        url = new URL(String(value || ''), WEREAD_WEB_ORIGIN);
    }
    catch {
        return '';
    }
    const pathParts = url.pathname.split('/').filter(Boolean);
    if (url.protocol !== 'https:' || url.hostname !== 'weread.qq.com' || pathParts[0] !== 'web' || pathParts[1] !== 'reader' || !pathParts[2]) {
        return '';
    }
    if (pathParts.length !== 3) {
        return '';
    }
    return url.toString();
}

async function fetchJson(url, label) {
    let resp;
    try {
        resp = await fetch(url.toString(), {
            headers: { 'User-Agent': WEREAD_UA },
        });
    }
    catch (error) {
        throw new CommandExecutionError(`${label} request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!resp.ok) {
        throw new CommandExecutionError(`${label} request failed: HTTP ${resp.status}`);
    }
    try {
        return await resp.json();
    }
    catch {
        throw new CommandExecutionError(`${label} returned invalid JSON`);
    }
}

async function fetchText(url, label) {
    let resp;
    try {
        resp = await fetch(url.toString(), {
            headers: { 'User-Agent': WEREAD_UA },
        });
    }
    catch (error) {
        throw new CommandExecutionError(`${label} request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!resp.ok) {
        throw new CommandExecutionError(`${label} request failed: HTTP ${resp.status}`);
    }
    return resp.text();
}

function buildReaderUrlFromInfoId(infoId) {
    const text = normalizeSearchText(infoId);
    return text ? `${WEREAD_WEB_ORIGIN}/web/reader/${text}` : '';
}

function extractReaderInitialState(html) {
    const marker = 'window.__INITIAL_STATE__=';
    const start = html.indexOf(marker);
    if (start < 0)
        return null;
    const jsonStart = start + marker.length;
    const cleanupStart = html.indexOf(';(function(){var s;', jsonStart);
    const scriptEnd = html.indexOf('</script>', jsonStart);
    const jsonEnd = cleanupStart >= 0 ? cleanupStart : scriptEnd;
    if (jsonEnd < 0)
        return null;
    try {
        return JSON.parse(html.slice(jsonStart, jsonEnd));
    }
    catch {
        return null;
    }
}

function extractJsonLdBookInfo(html) {
    const match = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!match)
        return {};
    try {
        const data = JSON.parse(match[1]);
        const info = {};
        info.bookId = normalizeSearchText(data?.['@Id']);
        info.title = normalizeSearchText(data?.name);
        info.author = normalizeSearchText(data?.author?.name);
        info.readerUrl = normalizeSearchText(data?.url);
        return info;
    }
    catch {
        return {};
    }
}

function parseReaderMetadata(html, readerUrl) {
    const state = extractReaderInitialState(html);
    const reader = state?.reader ?? {};
    const info = reader.bookInfo ?? {};
    const jsonLd = extractJsonLdBookInfo(html);
    const chapters = Array.isArray(reader.chapterInfos) ? reader.chapterInfos : [];
    const infoId = normalizeSearchText(reader.infoId) || normalizeSearchText(info.encodeId);
    const metadata = {};
    metadata.bookId = normalizeSearchText(info.bookId) || normalizeSearchText(reader.bookId) || jsonLd.bookId;
    metadata.title = normalizeSearchText(info.title) || jsonLd.title;
    metadata.author = normalizeSearchText(info.author) || jsonLd.author;
    metadata.readerUrl = normalizeSearchText(readerUrl) || buildReaderUrlFromInfoId(infoId) || jsonLd.readerUrl;
    metadata.chapters = chapters;
    return metadata;
}

async function loadReaderMetadata(readerUrl) {
    if (!readerUrl)
        return null;
    const html = await fetchText(readerUrl, 'WeRead reader page');
    const metadata = parseReaderMetadata(html, readerUrl);
    return metadata.bookId ? metadata : null;
}

function parseSearchHtmlEntries(html) {
    const items = Array.from(html.matchAll(/<li[^>]*class="wr_bookList_item"[^>]*>([\s\S]*?)<\/li>/g));
    return items.map((match) => {
        const chunk = match[1];
        const hrefMatch = chunk.match(/<a[^>]*href="([^"]+)"[^>]*class="wr_bookList_item_link"[^>]*>|<a[^>]*class="wr_bookList_item_link"[^>]*href="([^"]+)"[^>]*>/);
        const titleMatch = chunk.match(/<p[^>]*class="wr_bookList_item_title"[^>]*>([\s\S]*?)<\/p>/);
        const authorMatch = chunk.match(/<p[^>]*class="wr_bookList_item_author"[^>]*>([\s\S]*?)<\/p>/);
        const href = hrefMatch?.[1] || hrefMatch?.[2] || '';
        const entry = {};
        entry.title = decodeHtmlText(titleMatch?.[1] || '');
        entry.author = decodeHtmlText(authorMatch?.[1] || '');
        entry.readerUrl = href ? parseWereadReaderUrl(href) : '';
        return entry;
    }).filter((entry) => entry.title && entry.readerUrl);
}

async function loadSearchHtmlEntries(bookQuery) {
    const url = new URL('/web/search/books', WEREAD_WEB_ORIGIN);
    url.searchParams.set('keyword', bookQuery);
    return parseSearchHtmlEntries(await fetchText(url, 'WeRead search page'));
}

function resolveReaderUrlForBook(book, htmlEntries) {
    const title = normalizeSearchText(book.title);
    const author = normalizeSearchText(book.author);
    if (!title)
        return '';
    if (author) {
        const exact = htmlEntries.filter((entry) => normalizeSearchText(entry.title) === title && normalizeSearchText(entry.author) === author);
        if (exact.length === 1)
            return exact[0].readerUrl;
    }
    const sameTitle = htmlEntries.filter((entry) => normalizeSearchText(entry.title) === title);
    return sameTitle.length === 1 ? sameTitle[0].readerUrl : '';
}

async function searchBookByQuery(bookQuery, bookRank) {
    const url = new URL('/web/search/global', `${WEREAD_WEB_ORIGIN}/web`);
    url.searchParams.set('keyword', bookQuery);
    const data = await fetchJson(url, 'WeRead book search');
    if (!Array.isArray(data?.books)) {
        throw new CommandExecutionError('WeRead book search returned malformed books');
    }
    const books = data.books;
    if (books.length === 0) {
        throw new EmptyResultError('weread book-search', `No WeRead books found for "${bookQuery}"`);
    }
    if (bookRank > books.length) {
        throw new ArgumentError(`book-rank must be <= ${books.length}`, `Only ${books.length} book search result(s) were returned for "${bookQuery}"`);
    }
    const bookInfo = books[bookRank - 1]?.bookInfo ?? {};
    const selected = {
        bookId: normalizeSearchText(bookInfo.bookId),
        title: normalizeSearchText(bookInfo.title),
        author: normalizeSearchText(bookInfo.author),
        readerUrl: '',
        chapters: [],
    };
    if (!selected.bookId) {
        throw new CommandExecutionError(`WeRead book search result ${bookRank} is missing bookId`);
    }
    const htmlEntries = await loadSearchHtmlEntries(bookQuery);
    selected.readerUrl = resolveReaderUrlForBook(selected, htmlEntries);
    const readerMetadata = await loadReaderMetadata(selected.readerUrl);
    return {
        ...selected,
        ...Object.fromEntries(Object.entries(readerMetadata ?? {}).filter(([, value]) => value != null && value !== '' && !(Array.isArray(value) && value.length === 0))),
    };
}

async function resolveBookTarget(target, bookRank) {
    if (/^https?:\/\//i.test(target)) {
        const readerUrl = parseWereadReaderUrl(target);
        if (!readerUrl) {
            throw new ArgumentError('book URL must be a https://weread.qq.com/web/reader/<id> URL');
        }
        const metadata = await loadReaderMetadata(readerUrl);
        if (!metadata?.bookId) {
            throw new CommandExecutionError('Could not parse a bookId from the reader URL');
        }
        return metadata;
    }
    if (/^\d+$/.test(target)) {
        const metadata = {};
        metadata.bookId = target;
        metadata.title = '';
        metadata.author = '';
        metadata.readerUrl = '';
        metadata.chapters = [];
        return metadata;
    }
    return searchBookByQuery(target, bookRank);
}

async function searchWithinBook(bookId, query, limit, fragmentSize) {
    const rows = [];
    let maxIdx = 0;
    while (rows.length < limit) {
        const remaining = limit - rows.length;
        const pageSize = remaining < SEARCH_PAGE_SIZE ? remaining : SEARCH_PAGE_SIZE;
        const url = new URL('/web/book/search', WEREAD_WEB_ORIGIN);
        url.searchParams.set('bookId', bookId);
        url.searchParams.set('keyword', query);
        url.searchParams.set('maxIdx', String(maxIdx));
        url.searchParams.set('count', String(pageSize));
        url.searchParams.set('fragmentSize', String(fragmentSize));
        url.searchParams.set('onlyCount', '0');
        const data = await fetchJson(url, 'WeRead in-book search');
        if (!Array.isArray(data?.result)) {
            throw new CommandExecutionError('WeRead in-book search returned malformed result');
        }
        const result = data.result.map((item) => {
            if (!item || typeof item !== 'object') {
                throw new CommandExecutionError('WeRead in-book search returned malformed match');
            }
            const snippet = normalizeSearchText(item.abstract);
            const searchIdx = parseOptionalFiniteNumber(item.searchIdx);
            if (!snippet || searchIdx == null || searchIdx <= 0) {
                throw new CommandExecutionError('WeRead in-book search returned malformed match');
            }
            return {
                ...item,
                abstract: snippet,
                chapterIdx: parseOptionalFiniteNumber(item.chapterIdx),
                chapterUid: parseOptionalFiniteNumber(item.chapterUid),
                searchIdx,
            };
        });
        if (result.length === 0)
            break;
        rows.push(...result);
        const lastSearchIdx = result[result.length - 1].searchIdx;
        if (lastSearchIdx <= maxIdx)
            throw new CommandExecutionError('WeRead in-book search returned non-advancing searchIdx');
        maxIdx = lastSearchIdx;
        if (rows.length >= limit)
            break;
        const hasMore = parseHasMore(data?.hasMore);
        if (hasMore == null) {
            if (result.length < pageSize)
                break;
            throw new CommandExecutionError('WeRead in-book search returned malformed pagination state');
        }
        if (!hasMore)
            break;
    }
    if (rows.length === 0) {
        throw new EmptyResultError('weread book-search', `No matches for "${query}" in book ${bookId}`);
    }
    return rows.slice(0, limit);
}

function buildChapterMap(chapters) {
    const map = new Map();
    for (const chapter of chapters) {
        const chapterUid = parseOptionalFiniteNumber(chapter?.chapterUid);
        if (chapterUid == null)
            continue;
        map.set(chapterUid, {
            chapterIdx: parseOptionalFiniteNumber(chapter?.chapterIdx),
            chapterTitle: normalizeSearchText(chapter?.title),
        });
    }
    return map;
}

function buildRows(book, matches) {
    const chapterMap = buildChapterMap(book.chapters ?? []);
    return matches.map((item, index) => {
        const chapterUid = parseOptionalFiniteNumber(item?.chapterUid);
        const chapter = chapterMap.get(chapterUid) ?? {};
        const chapterIdx = chapter.chapterIdx ?? parseOptionalFiniteNumber(item?.chapterIdx);
        return {
            rank: index + 1,
            book_title: book.title || null,
            author: book.author || null,
            chapter_idx: chapterIdx,
            chapter_title: chapter.chapterTitle || null,
            snippet: normalizeSearchText(item?.abstract),
            search_idx: item.searchIdx,
            chapter_uid: chapterUid,
            book_id: book.bookId,
            url: book.readerUrl || null,
        };
    });
}

function formatMarkdownResults(book, query, rows) {
    const title = book.title || `WeRead book ${book.bookId}`;
    const lines = [`# ${title}`];
    if (book.author)
        lines.push(`- author: ${book.author}`);
    lines.push(`- book_id: \`${book.bookId}\``);
    lines.push(`- query: \`${query}\``);
    lines.push(`- matches: ${rows.length}`);
    if (book.readerUrl)
        lines.push(`- url: ${book.readerUrl}`);
    lines.push('');
    for (const row of rows) {
        const chapterLabel = row.chapter_title || `chapter ${row.chapter_uid ?? ''}`.trim();
        lines.push(`## ${row.rank}. ${chapterLabel}`);
        const details = [];
        if (row.chapter_idx !== null)
            details.push(`chapter_idx: ${row.chapter_idx}`);
        if (row.chapter_uid !== null)
            details.push(`chapter_uid: ${row.chapter_uid}`);
        details.push(`search_idx: ${row.search_idx}`);
        lines.push('');
        lines.push(`> ${row.snippet}`);
        lines.push('');
        for (const detail of details) {
            lines.push(`- ${detail}`);
        }
        if (row.rank < rows.length)
            lines.push('');
    }
    return lines.join('\n');
}

cli({
    site: 'weread',
    name: 'book-search',
    access: 'read',
    description: 'Search within a WeRead book after resolving it by title',
    domain: 'weread.qq.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    defaultFormat: 'md',
    args: [
        { name: 'book', positional: true, required: true, help: 'Book title keyword, numeric bookId, or reader URL' },
        { name: 'query', positional: true, required: true, help: 'Keyword to search inside the selected book' },
        { name: 'book-rank', type: 'int', default: 1, help: 'Which book search result to use when book is a title keyword' },
        { name: 'limit', type: 'int', default: 20, help: 'Max in-book matches to return (1-100)' },
        { name: 'fragment-size', type: 'int', default: 150, help: 'Snippet length around each match (1-500)' },
        { name: 'raw', type: 'boolean', default: false, help: 'Output structured rows instead of markdown text' },
    ],
    func: async (args) => {
        const bookTarget = normalizeRequiredString(args.book, 'book');
        const query = normalizeRequiredString(args.query, 'query');
        const bookRank = normalizePositiveInteger(args['book-rank'], 1, 'book-rank');
        const limit = normalizePositiveInteger(args.limit, 20, 'limit', MAX_LIMIT);
        const fragmentSize = normalizePositiveInteger(args['fragment-size'], 150, 'fragment-size', MAX_FRAGMENT_SIZE);
        const book = await resolveBookTarget(bookTarget, bookRank);
        const matches = await searchWithinBook(book.bookId, query, limit, fragmentSize);
        const rows = buildRows(book, matches);
        if (Boolean(args.raw))
            return rows;
        return [{ markdown: formatMarkdownResults(book, query, rows) }];
    },
});

export const __test__ = {
    buildRows,
    extractReaderInitialState,
    formatMarkdownResults,
    parseReaderMetadata,
    parseSearchHtmlEntries,
    resolveReaderUrlForBook,
};
