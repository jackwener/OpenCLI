/**
 * Xiaohongshu Collection Boards — 我的收藏 > 专辑 列表.
 *
 * Lists the collection albums (专辑) of a user, so you can grab a board id/name
 * to feed into `xiaohongshu collect-board`.
 *
 * Served by GET edith.xiaohongshu.com/api/sns/web/v1/board/user (x-s signed),
 * captured via INTERCEPT. Requires login for private boards / your own account.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { normalizeXhsUserId, resolveLoggedInUserId, fetchBoards } from './collect-helpers.js';

cli({
    site: 'xiaohongshu',
    name: 'collect-boards',
    description: '小红书「我的收藏」专辑列表 (收藏 > 专辑)',
    domain: 'www.xiaohongshu.com',
    strategy: Strategy.INTERCEPT,
    browser: true,
    args: [
        { name: 'user', type: 'string', positional: true, required: false, help: 'User id or profile URL (default: logged-in user)' },
    ],
    columns: ['id', 'name', 'count', 'privacy', 'desc'],
    func: async (page, kwargs) => {
        await page.goto('https://www.xiaohongshu.com/');
        const userId = kwargs.user
            ? normalizeXhsUserId(String(kwargs.user))
            : await resolveLoggedInUserId(page);
        const boards = await fetchBoards(page, userId);
        if (boards.length === 0) {
            throw new EmptyResultError('No collection boards found. Is this account signed in and does it have any 专辑?');
        }
        return boards;
    },
});
