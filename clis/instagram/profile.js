import { cli } from '@jackwener/opencli/registry';
import { mapInstagramProfileRow, readInstagramProfileUser } from './_shared/profile-web-client.js';
cli({
    site: 'instagram',
    name: 'profile',
    access: 'read',
    description: 'Get Instagram user profile info',
    domain: 'www.instagram.com',
    args: [
        { name: 'username', required: true, positional: true, help: 'Instagram username' },
    ],
    columns: ['username', 'name', 'followers', 'following', 'posts', 'verified', 'bio', 'avatar_url'],
    browser: true,
    navigateBefore: false,
    func: async (page, kwargs) => [mapInstagramProfileRow(await readInstagramProfileUser(page, kwargs.username))],
});
