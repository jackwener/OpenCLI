import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    callGateway,
    emptyResult,
    formatRating,
    makeDeepLink,
    requireBookId,
    requirePositiveInt,
    truncate,
} from './utils.js';

/**
 * Two endpoints share a single command surface:
 *   - no bookId → `/book/recommend` (personalized "for you" feed)
 *   - bookId    → `/book/similar`   (similar-books for a given book)
 *
 * Pagination differs: `/recommend` uses `searchIdx`; `/similar` uses `idx` plus
 * an opaque `sessionId` cursor. The CLI surfaces both verbatim so multi-page
 * fetches can use the SKILL contract without translation.
 */
cli({
    site: 'weread-official',
    name: 'discover',
    access: 'read',
    description: 'Personalized or similar-book recommendations from WeRead',
    domain: 'weread.qq.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'bookId', positional: true, help: 'Anchor bookId for similar-book mode; omit for personalized recommendations' },
        { name: 'count', type: 'int', default: 12, help: 'Page size (default 12)' },
        { name: 'max-idx', type: 'int', default: 0, help: 'Pagination cursor (recommend: previous searchIdx; similar: previous idx)' },
        { name: 'session-id', help: 'Carry-forward sessionId for /book/similar paging' },
    ],
    columns: ['rank', 'mode', 'bookId', 'title', 'author', 'rating', 'readingCount', 'category', 'idx', 'reason', 'cover', 'intro', 'link'],
    func: async (args) => {
        const count = requirePositiveInt(args.count, 'count', { defaultValue: 12, max: 50 });
        const maxIdx = Number(args['max-idx'] ?? 0);
        const rawBookId = args.bookId !== undefined && args.bookId !== null && String(args.bookId).trim() !== ''
            ? requireBookId(args.bookId)
            : null;

        if (!rawBookId) {
            return runRecommend({ count, maxIdx });
        }
        return runSimilar({ bookId: rawBookId, count, maxIdx, sessionId: args['session-id'] });
    },
});

async function runRecommend({ count, maxIdx }) {
    const payload = await callGateway('/book/recommend', { count, maxIdx });
    const books = Array.isArray(payload?.books) ? payload.books : [];
    if (books.length === 0) {
        emptyResult('discover', 'No personalized recommendations available.');
    }
    return books.map((entry, i) => {
        const bookId = String(entry?.bookId ?? '').trim();
        return {
            rank: i + 1,
            mode: 'recommend',
            bookId,
            title: String(entry?.title ?? ''),
            author: String(entry?.author ?? ''),
            rating: formatRating(entry?.newRating),
            readingCount: Number(entry?.readingCount ?? 0),
            category: String(entry?.category ?? ''),
            idx: Number(entry?.searchIdx ?? 0),
            reason: String(entry?.reason ?? ''),
            cover: String(entry?.cover ?? ''),
            intro: truncate(entry?.intro, 200),
            link: bookId ? makeDeepLink({ bookId }) : '',
        };
    });
}

async function runSimilar({ bookId, count, maxIdx, sessionId }) {
    const params = { bookId, count, maxIdx };
    const sid = String(sessionId ?? '').trim();
    if (sid) params.sessionId = sid;

    const payload = await callGateway('/book/similar', params);
    const inner = payload?.booksimilar ?? payload;
    const books = Array.isArray(inner?.books) ? inner.books : [];
    if (books.length === 0) {
        emptyResult('discover', `No similar books for bookId=${bookId}.`);
    }
    return books.map((wrapper, i) => {
        // /book/similar nests bookInfo under entry.book.bookInfo
        const info = wrapper?.book?.bookInfo ?? wrapper?.bookInfo ?? {};
        const id = String(info?.bookId ?? '').trim();
        return {
            rank: i + 1,
            mode: 'similar',
            bookId: id,
            title: String(info?.title ?? ''),
            author: String(info?.author ?? ''),
            rating: formatRating(info?.newRating),
            readingCount: Number(info?.readingCount ?? 0),
            category: String(info?.category ?? ''),
            idx: Number(wrapper?.idx ?? 0),
            reason: '', // /book/similar does not surface a recommendation reason
            cover: String(info?.cover ?? ''),
            intro: truncate(info?.intro, 200),
            link: id ? makeDeepLink({ bookId: id }) : '',
        };
    });
}
