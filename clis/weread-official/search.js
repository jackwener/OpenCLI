import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import {
    callGateway,
    emptyResult,
    formatRating,
    makeDeepLink,
    requirePositiveInt,
    requireText,
    truncate,
} from './utils.js';

/**
 * Search scope mapping — mirrors the official SKILL.md "scope 对应关系" table.
 * Keys are user-facing aliases; values are the int the gateway expects.
 */
export const SEARCH_SCOPES = Object.freeze({
    all: 0,
    ebook: 10,
    webnovel: 16,
    audio: 14,
    author: 6,
    fulltext: 12,
    booklist: 13,
    mp: 2,
    article: 4,
});

const SCOPE_LABEL = Object.freeze({
    0: '全部',
    10: '电子书',
    16: '网文小说',
    14: '微信听书',
    6: '作者',
    12: '全文',
    13: '书单',
    2: '公众号',
    4: '文章',
});

cli({
    site: 'weread-official',
    name: 'search',
    access: 'read',
    description: 'Search WeRead store via the official agent gateway',
    domain: 'weread.qq.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'keyword', positional: true, required: true, help: 'Search keyword' },
        { name: 'scope', default: 'ebook', choices: Object.keys(SEARCH_SCOPES), help: 'Search type (all/ebook/webnovel/audio/author/fulltext/booklist/mp/article)' },
        { name: 'count', type: 'int', help: 'Page size (gateway default 15 when omitted)' },
        { name: 'max-idx', type: 'int', default: 0, help: 'Pagination offset, use searchIdx of last item from previous page' },
    ],
    columns: ['rank', 'scope', 'bookId', 'title', 'author', 'rating', 'readingCount', 'category', 'searchIdx', 'cover', 'intro', 'link'],
    func: async (args) => {
        const keyword = requireText(args.keyword, 'keyword');
        const scopeKey = String(args.scope ?? 'ebook').trim();
        if (!Object.prototype.hasOwnProperty.call(SEARCH_SCOPES, scopeKey)) {
            throw new ArgumentError(
                `weread-official: scope must be one of: ${Object.keys(SEARCH_SCOPES).join(', ')}`,
            );
        }
        const scope = SEARCH_SCOPES[scopeKey];
        const params = { keyword, scope, maxIdx: args['max-idx'] ?? 0 };
        if (args.count !== undefined && args.count !== null && args.count !== '') {
            params.count = requirePositiveInt(args.count, 'count', { max: 100 });
        }

        const payload = await callGateway('/store/search', params);
        const groups = Array.isArray(payload?.results) ? payload.results : [];
        if (groups.length === 0) {
            emptyResult('search', `No results for "${keyword}" (scope=${scopeKey}).`);
        }

        const rows = [];
        let rank = 0;
        for (const group of groups) {
            const groupScope = SCOPE_LABEL[Number(group?.scope)] ?? '';
            const books = Array.isArray(group?.books) ? group.books : [];
            for (const entry of books) {
                rank += 1;
                const info = entry?.bookInfo ?? {};
                const bookId = String(info.bookId ?? '').trim();
                rows.push({
                    rank,
                    scope: groupScope,
                    bookId,
                    title: String(info.title ?? ''),
                    author: String(info.author ?? ''),
                    rating: formatRating(entry?.newRating),
                    readingCount: Number(entry?.readingCount ?? 0),
                    category: String(info.category ?? ''),
                    searchIdx: Number(entry?.searchIdx ?? 0),
                    cover: String(info.cover ?? ''),
                    intro: truncate(info.intro, 120),
                    link: bookId ? makeDeepLink({ bookId }) : '',
                });
            }
        }
        if (rows.length === 0) {
            emptyResult('search', `No books found in results for "${keyword}" (scope=${scopeKey}).`);
        }
        return rows;
    },
});
