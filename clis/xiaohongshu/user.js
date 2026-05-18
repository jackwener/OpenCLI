import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { extractXhsUserNotes, normalizeXhsUserId } from './user-helpers.js';
/**
 * Host-agnostic IIFE that snapshots the user profile's Pinia store. Exported
 * so the rednote adapter can reuse it without copying the safeClone block.
 */
export const USER_SNAPSHOT_JS = `
    (() => {
      const safeClone = (value) => {
        try {
          return JSON.parse(JSON.stringify(value ?? null));
        } catch {
          return null;
        }
      };

      const userStore = window.__INITIAL_STATE__?.user || {};
      return {
        noteGroups: safeClone(userStore.notes?._value || userStore.notes || []),
        pageData: safeClone(userStore.userPageData?._value || userStore.userPageData || {}),
      };
    })()
  `;
async function readUserSnapshot(page) {
    return await page.evaluate(USER_SNAPSHOT_JS);
}
export const command = cli({
    site: 'xiaohongshu',
    name: 'user',
    access: 'read',
    description: 'Get public notes from a Xiaohongshu user profile',
    domain: 'www.xiaohongshu.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'id', type: 'string', required: true, positional: true, help: 'User id or profile URL' },
        { name: 'limit', type: 'int', default: 15, help: 'Number of notes to return' },
    ],
    columns: ['id', 'title', 'type', 'likes', 'url'],
    func: async (page, kwargs) => {
        const userId = normalizeXhsUserId(String(kwargs.id));
        const limit = Math.max(1, Number(kwargs.limit ?? 15));
        await page.goto(`https://www.xiaohongshu.com/user/profile/${userId}`);
        let snapshot = await readUserSnapshot(page);
        let results = extractXhsUserNotes(snapshot ?? {}, userId);
        let previousCount = results.length;
        for (let i = 0; results.length < limit && i < 4; i += 1) {
            await page.autoScroll({ times: 1, delayMs: 1500 });
            await page.wait(1);
            snapshot = await readUserSnapshot(page);
            const nextResults = extractXhsUserNotes(snapshot ?? {}, userId);
            if (nextResults.length <= previousCount)
                break;
            results = nextResults;
            previousCount = nextResults.length;
        }
        if (results.length === 0) {
            // 与 bilibili subtitle 同模式：作者无公开内容是合法 empty 数据条件
            // （销号 / 私密号 / 全删笔记），不是 fetch 失败。下游应识别 code
            // EMPTY_RESULT 跳过 rate-limit 启发式、不计入 softFail 阈值。
            throw new EmptyResultError('xiaohongshu user', '该用户没有公开笔记（可能销号 / 私密 / 全部删除）。');
        }
        return results.slice(0, limit);
    },
});
