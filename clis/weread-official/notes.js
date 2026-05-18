import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    callGateway,
    emptyResult,
    formatDate,
    makeDeepLink,
    parseRange,
    requireBookId,
    requirePositiveInt,
    truncate,
} from './utils.js';

/**
 * Two modes share a single command (matches the ninehills reference shape):
 *
 *   - No bookId → `/user/notebooks` overview. One row per book that has notes.
 *                 Total-note column follows SKILL.md statistical contract:
 *                 `total = reviewCount + noteCount + bookmarkCount`. The
 *                 individual fields stay separate so downstream consumers do
 *                 not have to re-derive them.
 *
 *   - With bookId → merge `/book/bookmarklist` (highlights) +
 *                    `/review/list/mine` (thoughts/reviews) into one feed.
 *                    Bookmarks (type=0) are filtered server-side already.
 *
 * Pagination of `/user/notebooks` is cursor-based via `lastSort`; this command
 * surfaces `--last-sort` rather than offset/limit to keep the SKILL.md contract
 * visible at the CLI surface.
 */
cli({
    site: 'weread-official',
    name: 'notes',
    access: 'read',
    description: 'List notebooks overview or merged highlights+thoughts for a book',
    domain: 'weread.qq.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'bookId', positional: true, help: 'Limit to one book; omit for full notebook overview' },
        { name: 'count', type: 'int', default: 20, help: 'Page size for the notebooks overview (1-100)' },
        { name: 'last-sort', type: 'int', help: 'Cursor: pass previous page sort value to fetch the next page (/user/notebooks)' },
    ],
    columns: ['kind', 'bookId', 'title', 'author', 'chapter', 'reviewCount', 'noteCount', 'bookmarkCount', 'totalNotes', 'progress', 'finished', 'sort', 'range', 'text', 'thought', 'star', 'createTime', 'link'],
    func: async (args) => {
        const rawBookId = args.bookId !== undefined && args.bookId !== null && String(args.bookId).trim() !== ''
            ? requireBookId(args.bookId)
            : null;

        if (!rawBookId) {
            return listNotebooks(args);
        }
        return listBookNotes(rawBookId);
    },
});

async function listNotebooks(args) {
    const count = requirePositiveInt(args.count, 'count', { defaultValue: 20, max: 100 });
    const params = { count };
    if (args['last-sort'] !== undefined && args['last-sort'] !== null && args['last-sort'] !== '') {
        params.lastSort = requirePositiveInt(args['last-sort'], 'last-sort');
    }
    const payload = await callGateway('/user/notebooks', params);
    const books = Array.isArray(payload?.books) ? payload.books : [];
    if (books.length === 0) {
        emptyResult('notes', 'No notebooks found.');
    }
    return books.map((entry) => {
        const book = entry?.book ?? {};
        const bookId = String(entry?.bookId ?? book?.bookId ?? '').trim();
        const reviewCount = Number(entry?.reviewCount ?? 0);
        const noteCount = Number(entry?.noteCount ?? 0);
        const bookmarkCount = Number(entry?.bookmarkCount ?? 0);
        return {
            kind: 'notebook',
            bookId,
            title: String(book?.title ?? ''),
            author: String(book?.author ?? ''),
            chapter: '',
            reviewCount,
            noteCount,
            bookmarkCount,
            totalNotes: reviewCount + noteCount + bookmarkCount,
            progress: String(entry?.readingProgress ?? ''),
            finished: Number(entry?.markedStatus ?? 0) === 1,
            sort: Number(entry?.sort ?? 0),
            range: '',
            text: '',
            thought: '',
            star: '',
            createTime: '',
            link: bookId ? makeDeepLink({ bookId }) : '',
        };
    });
}

async function listBookNotes(bookId) {
    const [bookmarksResp, reviewsResp] = await Promise.all([
        callGateway('/book/bookmarklist', { bookId }),
        callGateway('/review/list/mine', { bookid: bookId }),
    ]);

    const chapterIndex = new Map();
    const chapterList = Array.isArray(bookmarksResp?.chapters) ? bookmarksResp.chapters : [];
    for (const ch of chapterList) {
        const uid = String(ch?.chapterUid ?? '').trim();
        if (!uid) continue;
        chapterIndex.set(uid, String(ch?.title ?? ''));
    }

    const rows = [];

    const bookmarks = Array.isArray(bookmarksResp?.updated) ? bookmarksResp.updated : [];
    for (const bm of bookmarks) {
        const chapterUid = String(bm?.chapterUid ?? '').trim();
        const { rangeStart, rangeEnd } = parseRange(bm?.range);
        rows.push({
            kind: 'highlight',
            bookId,
            title: '',
            author: '',
            chapter: chapterIndex.get(chapterUid) ?? '',
            reviewCount: 0,
            noteCount: 0,
            bookmarkCount: 0,
            totalNotes: 0,
            progress: '',
            finished: false,
            sort: 0,
            range: String(bm?.range ?? ''),
            text: truncate(bm?.markText, 400),
            thought: '',
            star: '',
            createTime: formatDate(bm?.createTime),
            link: rangeStart && rangeEnd && chapterUid
                ? makeDeepLink({ bookId, chapterUid, rangeStart, rangeEnd })
                : (chapterUid ? makeDeepLink({ bookId, chapterUid }) : makeDeepLink({ bookId })),
        });
    }

    const reviews = Array.isArray(reviewsResp?.reviews) ? reviewsResp.reviews : [];
    for (const wrapper of reviews) {
        const rv = wrapper?.review ?? {};
        const chapterUid = String(rv?.chapterUid ?? '').trim();
        const star = Number(rv?.star ?? -1);
        rows.push({
            kind: 'thought',
            bookId,
            title: '',
            author: '',
            chapter: String(rv?.chapterName ?? '') || (chapterIndex.get(chapterUid) ?? ''),
            reviewCount: 0,
            noteCount: 0,
            bookmarkCount: 0,
            totalNotes: 0,
            progress: '',
            finished: Number(rv?.isFinish ?? 0) === 1,
            sort: 0,
            range: String(rv?.range ?? ''),
            text: '',
            thought: truncate(rv?.content, 400),
            star: star >= 0 ? String(star) : '',
            createTime: formatDate(rv?.createTime),
            link: chapterUid ? makeDeepLink({ bookId, chapterUid }) : makeDeepLink({ bookId }),
        });
    }

    if (rows.length === 0) {
        emptyResult('notes', `No highlights or thoughts saved for bookId=${bookId}.`);
    }
    return rows;
}
