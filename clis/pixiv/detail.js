import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { pixivFetch } from './utils.js';

function requireIllustBody(body, id) {
    if (!body || Array.isArray(body) || typeof body !== 'object') {
        throw new CommandExecutionError(`Pixiv illustration ${id} returned malformed detail payload`);
    }
    const illustId = String(body.illustId ?? '').trim();
    const title = String(body.illustTitle ?? '').trim();
    const userName = String(body.userName ?? '').trim();
    const userId = String(body.userId ?? '').trim();
    if (!/^\d+$/.test(illustId) || illustId !== id || !title || !userName || !/^\d+$/.test(userId)) {
        throw new CommandExecutionError(`Pixiv illustration ${id} returned malformed detail payload`);
    }
    return { ...body, illustId, illustTitle: title, userName, userId };
}

cli({
    site: 'pixiv',
    name: 'detail',
    access: 'read',
    description: 'View illustration details (tags, stats, URLs)',
    domain: 'www.pixiv.net',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'id', required: true, positional: true, help: 'Illustration ID' },
    ],
    columns: [
        'illust_id',
        'title',
        'author',
        'type',
        'pages',
        'bookmarks',
        'likes',
        'views',
        'tags',
        'created',
        'url',
    ],
    func: async (page, kwargs) => {
        const id = String(kwargs.id ?? '');
        if (!/^\d+$/.test(id)) {
            throw new ArgumentError(`Invalid illustration ID: ${id}`, 'Example: opencli pixiv detail 123456');
        }
        const body = await pixivFetch(page, `/ajax/illust/${id}`, {
            notFoundMsg: `Illustration not found: ${id}`,
        });
        const b = requireIllustBody(body, id);
        return [{
            illust_id: b.illustId,
            title: b.illustTitle,
            author: b.userName,
            user_id: b.userId,
            type: b.illustType === 0 ? 'illust' : b.illustType === 1 ? 'manga' : b.illustType === 2 ? 'ugoira' : String(b.illustType),
            pages: b.pageCount,
            bookmarks: b.bookmarkCount,
            likes: b.likeCount,
            views: b.viewCount,
            tags: (b.tags?.tags || []).map(t => t.tag).join(', '),
            created: b.createDate?.split('T')[0] || '',
            url: `https://www.pixiv.net/artworks/${b.illustId}`,
        }];
    },
});
