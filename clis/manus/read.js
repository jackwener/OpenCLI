import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { MANUS_DOMAIN, ensureOnManus, MANUS_API_CALL_JS, requireArray, requireObject } from './_utils.js';

function formatTime(iso) {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    } catch {
        return iso;
    }
}

cli({
    site: 'manus',
    name: 'read',
    access: 'read',
    description: 'Show details for a specific Manus session.',
    domain: MANUS_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: true,
    args: [
        { name: 'uid', positional: true, required: true, help: 'Session UID' },
    ],
    columns: ['Field', 'Value'],
    func: async (page, kwargs) => {
        const uid = String(kwargs?.uid || '').trim();
        if (!uid) throw new ArgumentError('uid', 'must be a non-empty session UID');

        await ensureOnManus(page);

        const data = requireObject(await page.evaluate(`(async () => {
            ${MANUS_API_CALL_JS}
            return callManusAPI('session.v1.SessionService/ListSessions', {
                page: 1,
                pageSize: 100,
            });
        })()`), 'read session');

        const sessions = requireArray(data.sessions, 'read session');
        const session = sessions.find((s) => s.uid === uid);

        if (!session) {
            throw new EmptyResultError('manus read', `Session not found: ${uid}`);
        }

        return [
            { Field: 'UID', Value: session.uid || '—' },
            { Field: 'Title', Value: session.title || '—' },
            { Field: 'Status', Value: session.status || '—' },
            { Field: 'Mode', Value: session.agentTaskMode ?? '—' },
            { Field: 'Credits', Value: session.costedCredits ?? 0 },
            { Field: 'Created', Value: formatTime(session.createdAt) },
            { Field: 'Updated', Value: formatTime(session.updatedAt) },
            { Field: 'Last Display Message', Value: session.lastDisplayMessage || '—' },
        ];
    },
});
