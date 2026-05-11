import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { log } from '@jackwener/opencli/logger';
import { buildWebShelfEntries, fetchPrivateApi, loadWebShelfSnapshot, } from './utils.js';
function normalizeShelfLimit(limit) {
    if (!Number.isFinite(limit))
        return 0;
    return Math.max(0, Math.trunc(limit));
}
function normalizePrivateApiRows(data, limit) {
    const books = data?.books ?? [];
    return books.slice(0, limit).map((item) => ({
        title: item.bookInfo?.title ?? item.title ?? '',
        author: item.bookInfo?.author ?? item.author ?? '',
        // TODO: readingProgress field name from community docs, verify with real API response
        progress: item.readingProgress != null ? `${item.readingProgress}%` : '-',
        bookId: item.bookId ?? item.bookInfo?.bookId ?? '',
    }));
}
function normalizeWebShelfRows(snapshot, limit) {
    if (limit <= 0)
        return [];
    return buildWebShelfEntries(snapshot)
        .map((entry) => ({
        title: entry.title,
        author: entry.author,
        progress: '-',
        bookId: entry.bookId,
    }))
        .filter((item) => Boolean(item.title || item.bookId))
        .slice(0, limit);
}
cli({
    site: 'weread',
    name: 'shelf',
    access: 'read',
    description: 'List books on your WeRead bookshelf',
    domain: 'weread.qq.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Max results' },
    ],
    columns: ['title', 'author', 'progress', 'bookId'],
    func: async (page, args) => {
        const limit = normalizeShelfLimit(Number(args.limit));
        if (limit <= 0)
            return [];
        try {
            const data = await fetchPrivateApi(page, '/shelf/sync', { synckey: '0', lectureSynckey: '0' });
            return normalizePrivateApiRows(data, limit);
        }
        catch (error) {
            if (!(error instanceof CliError) || error.code !== 'AUTH_REQUIRED') {
                throw error;
            }
            const snapshot = await loadWebShelfSnapshot(page);
            if (!snapshot.cacheFound) {
                throw error;
            }
            // Make the fallback explicit so users do not mistake cached shelf data
            // for a valid private API session.
            log.warn('WeRead private API auth expired; showing cached shelf data from localStorage. Results may be stale, and detail commands may still require re-login.');
            return normalizeWebShelfRows(snapshot, limit);
        }
    },
});
