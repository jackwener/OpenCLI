import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { MANUS_DOMAIN, ensureOnManus, MANUS_API_CALL_JS, validatedLimit } from './_utils.js';

function formatTime(iso) {
    if (!iso) return '—';
    try {
        const d = new Date(iso);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
        return iso;
    }
}

function shortStatus(s) {
    if (!s) return '—';
    return s.replace('SESSION_STATUS_', '').toLowerCase();
}

cli({
    site: 'manus',
    name: 'list',
    access: 'read',
    description: 'List Manus sessions (tasks).',
    domain: MANUS_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: true,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Max sessions to return' },
        { name: 'archived', type: 'bool', default: false, help: 'Include archived sessions' },
    ],
    columns: ['UID', 'Title', 'Status', 'Last Message', 'Last Updated', 'Credits'],
    func: async (page, kwargs) => {
        const limit = validatedLimit(kwargs?.limit, 20, 200);
        const includeArchived = kwargs?.archived === true;
        await ensureOnManus(page);

        const data = await page.evaluate(`(async () => {
            ${MANUS_API_CALL_JS}
            return callManusAPI('session.v1.SessionService/ListSessions', {
                page: 1,
                pageSize: ${limit},
            });
        })()`);

        let sessions = data?.sessions || [];
        if (!includeArchived) {
            sessions = sessions.filter((s) => !s.isArchived);
        }

        if (!sessions.length) {
            throw new EmptyResultError('manus list', 'No sessions found.');
        }

        return sessions.slice(0, limit).map((s) => ({
            UID: s.uid || '—',
            Title: (s.title || '—').slice(0, 80),
            Status: shortStatus(s.status),
            'Last Message': (s.lastDisplayMessage || '—').slice(0, 80),
            'Last Updated': formatTime(s.updatedAt),
            Credits: String(s.costedCredits ?? '0'),
        }));
    },
});