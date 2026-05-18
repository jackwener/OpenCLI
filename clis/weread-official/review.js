import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import {
    callGateway,
    emptyResult,
    formatDate,
    formatStar,
    makeDeepLink,
    requireBookId,
    requirePositiveInt,
    truncate,
} from './utils.js';

/**
 * `/review/list` (public book reviews). Per SKILL.md the `reviewListType`
 * enum is:
 *   0=all  1=recommend  2=不行(thumbs-down)  3=newest  4=一般(neutral)
 *
 * Pagination is `idx`-based (use `idx` from last row of previous page as the
 * next `maxIdx`), with an optional `synckey` carried forward. Surface these
 * to the user instead of synthesizing an offset scheme so the SKILL contract
 * stays visible.
 */
const TYPE_ALIASES = Object.freeze({
    all: 0,
    recommend: 1,
    'thumbs-down': 2,
    newest: 3,
    neutral: 4,
});

cli({
    site: 'weread-official',
    name: 'review',
    access: 'read',
    description: 'Browse public reviews of a WeRead book',
    domain: 'weread.qq.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'bookId', positional: true, required: true, help: 'WeRead bookId (from `weread-official search`)' },
        { name: 'type', default: 'all', choices: Object.keys(TYPE_ALIASES), help: 'Review filter (all/recommend/thumbs-down/newest/neutral)' },
        { name: 'count', type: 'int', default: 20, help: 'Page size (1-100, default 20)' },
        { name: 'max-idx', type: 'int', default: 0, help: 'Pagination cursor — pass idx from last row of previous page' },
        { name: 'synckey', type: 'int', help: 'Sync cursor returned by previous response' },
    ],
    columns: ['rank', 'idx', 'reviewId', 'star', 'starLabel', 'author', 'isFinish', 'chapter', 'content', 'createTime', 'link'],
    func: async (args) => {
        const bookId = requireBookId(args.bookId);
        const typeKey = String(args.type ?? 'all').trim();
        if (!Object.prototype.hasOwnProperty.call(TYPE_ALIASES, typeKey)) {
            throw new ArgumentError(
                `weread-official: type must be one of: ${Object.keys(TYPE_ALIASES).join(', ')}`,
            );
        }
        const reviewListType = TYPE_ALIASES[typeKey];
        const count = requirePositiveInt(args.count, 'count', { defaultValue: 20, max: 100 });
        const params = { bookId, reviewListType, count, maxIdx: Number(args['max-idx'] ?? 0) };
        if (args.synckey !== undefined && args.synckey !== null && args.synckey !== '') {
            params.synckey = requirePositiveInt(args.synckey, 'synckey');
        }

        const payload = await callGateway('/review/list', params);
        const reviews = Array.isArray(payload?.reviews) ? payload.reviews : [];
        if (reviews.length === 0) {
            emptyResult('review', `No public reviews for bookId=${bookId} (type=${typeKey}).`);
        }

        return reviews.map((wrapper, i) => {
            const reviewOuter = wrapper?.review ?? {};
            // `/review/list` nests the actual review under reviewOuter.review
            const rv = reviewOuter?.review ?? {};
            const author = rv?.author ?? {};
            const chapter = String(rv?.chapterName ?? '').trim();
            const reviewId = String(reviewOuter?.reviewId ?? rv?.reviewId ?? '').trim();
            return {
                rank: i + 1,
                idx: Number(wrapper?.idx ?? 0),
                reviewId,
                star: Number(rv?.star ?? 0),
                starLabel: formatStar(rv?.star),
                author: String(author?.name ?? ''),
                isFinish: Number(rv?.isFinish ?? 0) === 1,
                chapter,
                content: truncate(rv?.content, 300),
                createTime: formatDate(rv?.createTime),
                link: makeDeepLink({ bookId }),
            };
        });
    },
});

export { TYPE_ALIASES };
