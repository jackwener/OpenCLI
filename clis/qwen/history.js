import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    QIANWEN_DOMAIN,
    authRequired,
    dismissLoginModal,
    ensureOnQianwen,
    getSessionListFromApi,
} from './utils.js';

function formatDate(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

cli({
    site: 'qwen',
    name: 'history',
    access: 'read',
    description: 'List recent Qianwen conversations (requires login)',
    domain: QIANWEN_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    browserSession: { reuse: 'site' },
    navigateBefore: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Max conversations to show (default 20, max 100)' },
    ],
    columns: ['Index', 'Title', 'Updated', 'Url'],
    func: async (page, kwargs) => {
        const limit = Number(kwargs.limit ?? 20);
        if (!Number.isInteger(limit) || limit <= 0) {
            throw new ArgumentError('limit must be a positive integer');
        }
        if (limit > 100) {
            throw new ArgumentError('limit must be <= 100');
        }
        await ensureOnQianwen(page);
        await dismissLoginModal(page);
        await page.wait(1);
        const result = await getSessionListFromApi(page, limit);
        if (!result.ok) {
            if (result.status === 401 || result.status === 403) throw authRequired();
            if (!result.sessions.length) {
                throw new CommandExecutionError(`Qianwen history API failed (status=${result.status}) ${result.error || ''}`.trim());
            }
        }
        if (!result.sessions.length) {
            throw new EmptyResultError('qwen history', 'No Qianwen conversations found.');
        }
        return result.sessions.slice(0, limit).map((s, i) => ({
            Index: i + 1,
            Title: s.title || '(untitled)',
            Updated: formatDate(s.updated_at),
            Url: `https://www.qianwen.com/chat/${s.id}`,
        }));
    },
});
