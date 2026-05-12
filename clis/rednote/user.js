import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { USER_SNAPSHOT_JS } from '../xiaohongshu/user.js';
import { extractXhsUserNotes, normalizeXhsUserId } from '../xiaohongshu/user-helpers.js';

const WEB_HOST = 'www.rednote.com';

function parseLimit(raw) {
    const parsed = Number(raw ?? 15);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        throw new ArgumentError(`--limit must be a positive integer, got ${JSON.stringify(raw)}`);
    }
    if (parsed < 1) {
        throw new ArgumentError(`--limit must be a positive integer, got ${parsed}`);
    }
    return parsed;
}

export const command = cli({
    site: 'rednote',
    name: 'user',
    access: 'read',
    description: 'Get public notes from a rednote user profile',
    domain: WEB_HOST,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'id', type: 'str', required: true, positional: true, help: 'User id or profile URL' },
        { name: 'limit', type: 'int', default: 15, help: 'Number of notes to return' },
    ],
    columns: ['id', 'title', 'type', 'likes', 'url'],
    func: async (page, kwargs) => {
        const userId = normalizeXhsUserId(String(kwargs.id));
        const limit = parseLimit(kwargs.limit);
        await page.goto(`https://${WEB_HOST}/user/profile/${userId}`);
        let snapshot = await page.evaluate(USER_SNAPSHOT_JS);
        let results = extractXhsUserNotes(snapshot ?? {}, userId, WEB_HOST);
        let previousCount = results.length;
        for (let i = 0; results.length < limit && i < 4; i += 1) {
            await page.autoScroll({ times: 1, delayMs: 1500 });
            await page.wait({ time: 1 });
            snapshot = await page.evaluate(USER_SNAPSHOT_JS);
            const nextResults = extractXhsUserNotes(snapshot ?? {}, userId, WEB_HOST);
            if (nextResults.length <= previousCount)
                break;
            results = nextResults;
            previousCount = nextResults.length;
        }
        if (results.length === 0) {
            throw new EmptyResultError('rednote/user', 'No public notes found for this rednote user.');
        }
        return results.slice(0, limit);
    },
});
