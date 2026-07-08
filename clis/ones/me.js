import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { onesFetchInPage } from './common.js';
cli({
    site: 'ones',
    name: 'me',
    access: 'read',
    description: 'ONES Project API — current user (GET users/me) via Chrome Bridge',
    domain: 'ones.cn',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [],
    columns: ['uuid', 'name', 'email', 'phone', 'status'],
    func: async (page) => {
        const data = (await onesFetchInPage(page, 'users/me'));
        const u = data.user && typeof data.user === 'object' ? data.user : data;
        if (!u || typeof u.uuid !== 'string') {
            throw new CliError('FETCH_ERROR', 'Unexpected users/me response', 'See raw JSON with: opencli ones me -f json');
        }
        return [
            {
                uuid: String(u.uuid),
                name: String(u.name ?? ''),
                email: String(u.email ?? ''),
                phone: String(u.phone ?? ''),
                status: u.status != null ? String(u.status) : '',
            },
        ];
    },
});
