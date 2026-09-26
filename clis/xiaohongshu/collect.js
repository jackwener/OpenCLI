/**
 * Xiaohongshu Collected Notes — 我的收藏 > 笔记（当前登录用户收藏的笔记列表）.
 *
 * The collected-notes list is served by
 *   GET edith.xiaohongshu.com/api/sns/web/v2/note/collect/page
 * which requires XHS's x-s signature, so a raw fetch() fails with
 * "create invalid signature". We therefore let the page fire its own signed
 * requests (click 收藏 tab, then scroll to paginate) and INTERCEPT the
 * responses.
 *
 * Requires: logged into www.xiaohongshu.com in Chrome (web_session cookie).
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';
import { normalizeXhsUserId, resolveLoggedInUserId, unwrap, mapCollectedNote } from './collect-helpers.js';

const COLLECT_API_PATH = 'note/collect/page';

cli({
    site: 'xiaohongshu',
    name: 'collect',
    description: '小红书「我的收藏」笔记列表 (收藏 > 笔记)',
    domain: 'www.xiaohongshu.com',
    strategy: Strategy.INTERCEPT,
    browser: true,
    args: [
        { name: 'user', type: 'string', positional: true, required: false, help: 'User id or profile URL (default: logged-in user)' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of notes to return' },
    ],
    columns: ['rank', 'id', 'title', 'author', 'type', 'likes', 'url'],
    func: async (page, kwargs) => {
        const limit = Math.max(1, Number(kwargs.limit ?? 20));

        // 1. Land on the profile page (goto resets JS context).
        const userId = kwargs.user
            ? normalizeXhsUserId(String(kwargs.user))
            : await resolveLoggedInUserId(page);
        await page.goto(`https://www.xiaohongshu.com/user/profile/${userId}`);
        await page.wait(2);

        // 2. Install the interceptor AFTER goto but BEFORE the SPA tab click, so
        //    the signed collect/page requests are captured.
        await page.installInterceptor(COLLECT_API_PATH);

        // 3. Click the 收藏 tab — defaults to its 笔记 sub-tab, which fires the
        //    first collect/page request.
        const clicked = await page.evaluate(`
            (() => {
                const tab = [...document.querySelectorAll('.reds-tab-item.sub-tab-list')]
                    .find((el) => el.textContent.trim() === '收藏');
                if (tab) { tab.click(); return true; }
                return false;
            })()
        `);
        if (!clicked) {
            throw new EmptyResultError('Could not find the 收藏 tab on the profile page. The profile may be private or the layout changed.');
        }
        await page.waitForCapture(6);

        // 4. Scroll to trigger paginated collect/page requests until we have enough.
        const seen = new Set();
        const rows = [];
        const maxScrolls = Math.ceil(limit / 30) + 4;
        for (let i = 0; i < maxScrolls; i++) {
            const requests = await page.getInterceptedRequests();
            for (const req of Array.isArray(requests) ? requests : []) {
                const notes = unwrap(req?.data)?.notes;
                for (const note of Array.isArray(notes) ? notes : []) {
                    const row = mapCollectedNote(note);
                    if (!row || seen.has(row.id))
                        continue;
                    seen.add(row.id);
                    rows.push(row);
                }
            }
            if (rows.length >= limit)
                break;
            await page.autoScroll({ times: 1, delayMs: 1800 });
            await page.wait(1);
        }

        if (rows.length === 0) {
            throw new AuthRequiredError('www.xiaohongshu.com', 'No collected notes found. Is this account signed in and does it have any 收藏?');
        }

        return rows.slice(0, limit).map((row, i) => ({ rank: i + 1, ...row }));
    },
});
