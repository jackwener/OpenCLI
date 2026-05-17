/**
 * `opencli suno list` — list recent clips in the user's library. Lets agents
 * discover clip ids without needing to remember them, and feed them to
 * `opencli suno download`.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import {
    STUDIO_API,
    SUNO_DOMAIN,
    SUNO_URL,
    ensureSunoSession,
    requirePositiveInt,
} from './utils.js';

export const listCommand = cli({
    site: 'suno',
    name: 'list',
    access: 'read',
    description: 'List recent Suno clips in your library (id, title, status, created_at, link)',
    domain: SUNO_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Max clips to list (default: 20)' },
        { name: 'page', type: 'int', default: 0, help: 'Pagination offset, 0-based (default: 0)' },
    ],
    columns: ['rank', 'clip', 'title', 'status', 'created', 'link'],
    func: async (page, kwargs) => {
        const limit = requirePositiveInt(kwargs.limit, '--limit');
        const pageOffset = Number.isInteger(kwargs.page) && kwargs.page >= 0 ? kwargs.page : 0;

        const session = await ensureSunoSession(page);
        const deviceId = session.deviceId;

        const result = await page.evaluate(`(async () => {
            const browserToken = JSON.stringify({ token: btoa(JSON.stringify({ timestamp: Date.now() })) });
            const res = await fetch('${STUDIO_API}/api/feed/v2?page=${pageOffset}', {
                headers: {
                    'Authorization': 'Bearer ' + (await window.Clerk.session.getToken()),
                    'browser-token': browserToken,
                    'device-id': ${JSON.stringify(deviceId)},
                },
            });
            if (!res.ok) return { ok: false, status: res.status };
            const data = await res.json();
            return { ok: true, clips: data?.clips || [] };
        })()`);

        if (!result?.ok) {
            throw new CommandExecutionError(`Suno feed lookup failed (HTTP ${result?.status || '?'}).`);
        }

        return result.clips.slice(0, limit).map((c, i) => ({
            rank: i + 1 + pageOffset * limit,
            clip: c.id.slice(0, 8),
            title: c.title || '(untitled)',
            status: c.status || '?',
            created: (c.created_at || '').replace('T', ' ').replace(/\..*$/, '').replace(/Z$/, ''),
            link: `${SUNO_URL}/song/${c.id}`,
        }));
    },
});
