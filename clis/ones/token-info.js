import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { onesFetchInPage } from './common.js';
cli({
    site: 'ones',
    name: 'token-info',
    access: 'read',
    description: 'ONES Project API — session detail (GET auth/token_info) via Chrome Bridge: user, teams, org',
    domain: 'ones.cn',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [],
    columns: ['uuid', 'name', 'email', 'teams', 'org_name'],
    func: async (page) => {
        const root = (await onesFetchInPage(page, 'auth/token_info'));
        const user = root.user && typeof root.user === 'object' ? root.user : null;
        if (!user?.uuid) {
            throw new CliError('FETCH_ERROR', 'Unexpected auth/token_info response', 'Try `opencli ones me -f json` or check ONES_* env vars.');
        }
        const teamRows = Array.isArray(root.teams) ? root.teams : [];
        const teamsHint = teamRows
            .map((t) => {
            const n = String(t.name ?? '').trim();
            const u = String(t.uuid ?? '').trim();
            if (n && u)
                return `${n} (${u})`;
            return u || n;
        })
            .filter(Boolean)
            .join(', ');
        const org = root.org && typeof root.org === 'object' ? root.org : null;
        return [
            {
                uuid: String(user.uuid),
                name: String(user.name ?? ''),
                email: String(user.email ?? ''),
                teams: teamsHint,
                org_name: org ? String(org.name ?? '') : '',
            },
        ];
    },
});
