import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { pixivFetch } from './utils.js';

function requireUserBody(body, uid) {
    if (!body || Array.isArray(body) || typeof body !== 'object') {
        throw new CommandExecutionError(`Pixiv user ${uid} returned malformed profile payload`);
    }
    const name = String(body.name ?? '').trim();
    if (!name) {
        throw new CommandExecutionError(`Pixiv user ${uid} returned malformed profile payload`);
    }
    return { ...body, name };
}

cli({
    site: 'pixiv',
    name: 'user',
    access: 'read',
    description: 'View Pixiv artist profile',
    domain: 'www.pixiv.net',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'uid', required: true, positional: true, help: 'Pixiv user ID' },
    ],
    columns: [
        'user_id',
        'name',
        'premium',
        'following',
        'illusts',
        'manga',
        'novels',
        'comment',
        'url',
    ],
    func: async (page, kwargs) => {
        const uid = String(kwargs.uid ?? '');
        if (!/^\d+$/.test(uid)) {
            throw new ArgumentError(`Invalid user ID: ${uid}`, 'Example: opencli pixiv user 123456');
        }
        const body = await pixivFetch(page, `/ajax/user/${uid}`, {
            params: { full: 1 },
            notFoundMsg: `User not found: ${uid}`,
        });
        const b = requireUserBody(body, uid);
        return [{
            user_id: uid,
            name: b.name,
            premium: b.premium ? 'Yes' : 'No',
            following: b.following,
            illusts: typeof b.illusts === 'object' ? Object.keys(b.illusts).length : (b.illusts || 0),
            manga: typeof b.manga === 'object' ? Object.keys(b.manga).length : (b.manga || 0),
            novels: typeof b.novels === 'object' ? Object.keys(b.novels).length : (b.novels || 0),
            comment: (b.comment || '').slice(0, 80),
            url: `https://www.pixiv.net/users/${uid}`,
        }];
    },
});
