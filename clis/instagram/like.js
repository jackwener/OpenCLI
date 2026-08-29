import { cli } from '@jackwener/opencli/registry';
import { setInstagramPostLike } from './_shared/post-like.js';

cli({
    site: 'instagram',
    name: 'like',
    access: 'write',
    description: 'Like an Instagram post',
    domain: 'www.instagram.com',
    browser: true,
    args: [
        {
            name: 'username',
            required: true,
            positional: true,
            help: 'Username of the post author',
        },
        { name: 'index', type: 'int', default: 1, help: 'Post index (1 = most recent)' },
    ],
    columns: ['status', 'user', 'post'],
    func: async (page, kwargs) => setInstagramPostLike(page, kwargs, true),
});
