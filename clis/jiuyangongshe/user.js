// jiuyangongshe user — articles posted by a single contributor.
//
// Source: GET https://www.jiuyangongshe.com/u/{userId}
//
// The SSR payload exposes both a profile block and the contributor's post
// list:
//   data[0].userInfo  → { user_id, nickname, integral, fans_count,
//                         follow_count, profile, ... }
//   data[0].list[]    → article items shaped the same as the feed pages
//   data[0].paginate  → { page, pageSize, total }
//
// Note: the SSR request does NOT honor `?page=` query params — the rendered
// `data[0]` is always page 1. The `--page` flag is accepted for
// forward-compatibility (and so that callers don't have to edit their
// invocation when this limitation is lifted), but currently has no effect
// on the data returned.
//
// The userInfo profile block is intentionally NOT exposed as a row; the
// declared column schema is article-only. Callers that need the profile
// should reach for `detail` against a specific post and inspect the author
// fields there, or watch for future dedicated profile commands.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    fetchPage,
    extractNuxtPayload,
    shapeArticleRow,
} from './_util.js';

/** Build the canonical user-profile URL with the id properly encoded. */
function userUrl(userId) {
    return `https://www.jiuyangongshe.com/u/${encodeURIComponent(userId)}`;
}

cli({
    site: 'jiuyangongshe',
    name: 'user',
    access: 'read',
    description: 'Articles posted by a single contributor on 韭研公社',
    domain: 'www.jiuyangongshe.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        {
            name: 'userId',
            positional: true,
            required: true,
            help: 'User ID, e.g. ecbd697906d542919f2c13628b06f807',
        },
        { name: 'limit', type: 'int', default: 20, help: 'Max rows to return (default 20, max 50)' },
        {
            name: 'page',
            type: 'int',
            default: 1,
            help: 'Page number (default 1). NOTE: the SSR endpoint always returns page 1 regardless of this value.',
        },
    ],
    columns: [
        'rank', 'id', 'title', 'publishedAt', 'comments', 'likes', 'collects', 'url',
    ],
    func: async (args) => {
        const userId = String(args.userId ?? '').trim();
        if (!userId) {
            throw new ArgumentError(
                'userId cannot be empty',
                'Pass a non-empty user id, e.g.: opencli jiuyangongshe user ecbd697906d542919f2c13628b06f807',
            );
        }
        const limit = Math.max(1, Math.min(50, Number(args.limit) || 20));
        // `page` is intentionally read (and validated) but not passed to
        // the SSR URL — the site ignores it. See the file header.
        const page = Math.max(1, Math.floor(Number(args.page) || 1));
        void page;

        const html = await fetchPage(userUrl(userId));
        const payload = extractNuxtPayload(html);
        const entry = Array.isArray(payload?.data) ? payload.data[0] : null;
        const rawList = entry && Array.isArray(entry.list) ? entry.list : [];
        const isEmptyFlag = entry && typeof entry.isEmpty === 'boolean' ? entry.isEmpty : false;

        if (isEmptyFlag || !rawList.length) {
            throw new EmptyResultError(
                'jiuyangongshe user',
                `No articles found for user "${userId}" — the profile may be private, deleted, or the id is incorrect.`,
            );
        }

        const rows = [];
        for (let idx = 0; idx < rawList.length && rows.length < limit; idx += 1) {
            const row = shapeArticleRow(rawList[idx], rows.length);
            if (row) rows.push(row);
        }
        if (!rows.length) {
            throw new EmptyResultError(
                'jiuyangongshe user',
                `All posts for user "${userId}" were filtered out.`,
            );
        }
        return rows;
    },
});