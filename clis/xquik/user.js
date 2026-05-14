import { cli, Strategy } from '@jackwener/opencli/registry';
import { normalizeUser, requireString, xquikFetch } from './utils.js';

cli({
    site: 'xquik',
    name: 'user',
    access: 'read',
    description: 'Look up an X/Twitter user profile by username or ID through Xquik.',
    domain: 'xquik.com',
    strategy: Strategy.LOCAL,
    browser: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'Username without @, @username, or numeric user ID' },
    ],
    columns: ['id', 'username', 'name', 'followers', 'following', 'verified', 'description', 'location', 'createdAt', 'profileUrl'],
    func: async (args) => {
        const id = encodeURIComponent(requireString(args.id, 'id').replace(/^@+/, ''));
        const body = await xquikFetch(`/x/users/${id}`, 'xquik user');
        return [normalizeUser(body, 0)];
    },
});
