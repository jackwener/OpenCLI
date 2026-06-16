import { cli, Strategy } from '@jackwener/opencli/registry';
import { COLLECT_API_PATTERN, fetchXhsCollectionNotes, parseCollectionLimit, resolveXhsUserId, SAVED_PROFILE_TAB } from './collection-helpers.js';

cli({
    site: 'xiaohongshu',
    name: 'saved',
    access: 'read',
    description: '小红书收藏笔记列表',
    domain: 'www.xiaohongshu.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    browser: true,
    args: [
        { name: 'id', type: 'string', help: 'User id or profile URL (defaults to current logged-in user)' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of notes to return' },
    ],
    columns: ['rank', 'id', 'title', 'author', 'likes', 'type', 'url'],
    func: async (page, kwargs) => {
        const limit = parseCollectionLimit(kwargs.limit);
        const userId = await resolveXhsUserId(page, kwargs.id);
        return fetchXhsCollectionNotes(page, {
            userId,
            profileTab: SAVED_PROFILE_TAB,
            apiPattern: COLLECT_API_PATTERN,
            limit,
            emptyLabel: 'saved',
        });
    },
});
