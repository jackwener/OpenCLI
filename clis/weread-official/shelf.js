import { cli, Strategy } from '@jackwener/opencli/registry';
import { callGateway, emptyResult, formatDate, makeDeepLink } from './utils.js';

/**
 * `/shelf/sync` returns three independent entry kinds:
 *   - `books[]`   — ebooks / imported / mp-style book entries
 *   - `albums[]`  — audiobooks / podcasts (官方 SKILL.md 强调专辑 = 有声书)
 *   - `mp`        — opaque "文章收藏" (article bookmarks) entry; non-empty
 *                   = 1 shelf entry but its content is NOT exposed here.
 *
 * Per official skill: shelf count = books.length + albums.length +
 *                     (mp non-empty ? 1 : 0). This adapter surfaces all three
 *                     row kinds in a `kind` column so callers can filter.
 */
cli({
    site: 'weread-official',
    name: 'shelf',
    access: 'read',
    description: 'Sync your WeRead shelf (books + albums + article bookmark entry) via the official gateway',
    domain: 'weread.qq.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [],
    columns: ['kind', 'id', 'title', 'author', 'category', 'secret', 'isTop', 'finished', 'updateTime', 'cover', 'link'],
    func: async () => {
        const payload = await callGateway('/shelf/sync', {});
        const books = Array.isArray(payload?.books) ? payload.books : [];
        const albums = Array.isArray(payload?.albums) ? payload.albums : [];
        // `mp` is an object (or array) marking the "文章收藏" entry. Non-empty = 1 shelf entry.
        const mp = payload?.mp;
        const hasMp = Boolean(
            mp && typeof mp === 'object'
                && (Array.isArray(mp) ? mp.length > 0 : Object.keys(mp).length > 0),
        );

        const rows = [];

        for (const b of books) {
            const bookId = String(b?.bookId ?? '').trim();
            rows.push({
                kind: 'book',
                id: bookId,
                title: String(b?.title ?? ''),
                author: String(b?.author ?? ''),
                category: String(b?.category ?? ''),
                secret: Number(b?.secret ?? 0) === 1,
                isTop: Number(b?.isTop ?? 0) === 1,
                finished: Number(b?.finishReading ?? 0) === 1,
                updateTime: formatDate(b?.readUpdateTime ?? b?.updateTime),
                cover: String(b?.cover ?? ''),
                link: bookId ? makeDeepLink({ bookId }) : '',
            });
        }

        for (const a of albums) {
            const info = a?.albumInfo ?? {};
            const extra = a?.albumInfoExtra ?? {};
            const albumId = String(info?.albumId ?? '').trim();
            rows.push({
                kind: 'album',
                id: albumId,
                title: String(info?.name ?? ''),
                author: String(info?.authorName ?? ''),
                category: '',
                secret: Number(extra?.secret ?? 0) === 1,
                isTop: Number(extra?.isTop ?? 0) === 1,
                finished: Number(info?.finish ?? 0) === 1,
                updateTime: formatDate(extra?.lectureReadUpdateTime ?? info?.updateTime),
                cover: String(info?.cover ?? ''),
                link: '',
            });
        }

        if (hasMp) {
            // The mp entry is an opaque directory; only the count is meaningful here.
            // Per SKILL.md it's always private, so secret=true matches the official rule.
            rows.push({
                kind: 'mp',
                id: '',
                title: '文章收藏',
                author: '',
                category: '',
                secret: true,
                isTop: false,
                finished: false,
                updateTime: '',
                cover: '',
                link: '',
            });
        }

        if (rows.length === 0) {
            emptyResult('shelf', 'Your WeRead shelf is empty.');
        }
        return rows;
    },
});
