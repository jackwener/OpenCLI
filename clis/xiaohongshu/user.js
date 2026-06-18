import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
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

      const userStore = window.__INITIAL_STATE__?.user;
      const hasUserStore = Boolean(userStore && typeof userStore === 'object');
      const rawNotes = hasUserStore ? (userStore.notes?._value || userStore.notes) : undefined;
      const rawPageData = hasUserStore ? (userStore.userPageData?._value || userStore.userPageData) : undefined;
      // 登录墙检测：小红书 profile 页比 search 更吃登录态，会话失效/被风控降级时访问
      // /user/profile/<id> 会 302 到 /login（loggedIn=false）。用 indexOf 而非正则——
      // 本块是嵌在模板字符串里的 JS，正则 \\b 会被模板解析成退格符。
      const loggedInVal = hasUserStore ? (userStore.loggedIn?._value ?? userStore.loggedIn) : undefined;
      const pathName = (typeof location !== 'undefined' && location.pathname) ? location.pathname : '';
      const onLoginPage = pathName.indexOf('/login') === 0;
      return {
        noteGroups: safeClone(rawNotes || []),
        pageData: safeClone(rawPageData || {}),
        storePresent: hasUserStore,
        notesPresent: Array.isArray(rawNotes),
        pageDataPresent: Boolean(rawPageData && typeof rawPageData === 'object' && Object.keys(rawPageData).length > 0),
        loginWall: Boolean(onLoginPage || loggedInVal === false),
      };
    })()
  `;
async function readUserSnapshot(page) {
    return await page.evaluate(USER_SNAPSHOT_JS);
}
export function assertReadableUserSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        throw new CommandExecutionError('Malformed Xiaohongshu user snapshot');
    }
    if (snapshot.storePresent !== true) {
        throw new CommandExecutionError('Malformed Xiaohongshu user snapshot: user store was not found');
    }
    if (snapshot.notesPresent !== true || !Array.isArray(snapshot.noteGroups)) {
        throw new CommandExecutionError('Malformed Xiaohongshu user snapshot: notes array was not found');
    }
}
/** 展平 noteGroups 后的真实笔记条数。小红书 user store 的 notes 是 [tab[], tab[], ...]
 *  形态（每个 tab 一个数组），首屏笔记在其中某个 tab 里；这里数所有 tab 里的笔记总数。 */
export function countFlatNotes(snapshot) {
    const groups = snapshot?.noteGroups;
    if (!Array.isArray(groups))
        return 0;
    let n = 0;
    for (const g of groups)
        n += Array.isArray(g) ? g.length : (g ? 1 : 0);
    return n;
}
/** 页面是否被登录墙挡（302 到 /login，或 user store loggedIn=false）。 */
export function isLoginWallSnapshot(snapshot) {
    return Boolean(snapshot && typeof snapshot === 'object' && snapshot.loginWall === true);
}
function throwLoginWallAuthRequired() {
    throw new AuthRequiredError('xiaohongshu.com', 'Xiaohongshu profile requires login (page redirected to /login or session expired); re-login to xiaohongshu.com and retry.');
}
/**
 * 读取 user 快照，带 hydration 等待 + 重试。修两个真实坑：
 *  1) 慢加载竞态：`__INITIAL_STATE__.user` 由 SSR/client bootstrap 异步注入，`page.goto` 后
 *     立刻 evaluate 会撞 hydration 窗口 → store/notes 尚未就绪。note.js / download.js 早用
 *     `page.wait` 规避，唯独 user.js 漏了 → 间歇性 "user store was not found"（2026-06-09 整批
 *     seed 全挂、2026-05-20 亦复现）。
 *  2) 笔记懒加载：`notes` 是 [tab[], ...] 形态，首屏笔记可能比 store 更晚填充。
 * 策略：先快读一次（页面已就绪则零额外延迟，保住快加载路径）；未拿到笔记**且非登录墙**就
 * `page.wait` 后重试至多 maxRetries 次。命中登录墙立即停（再等无用，交给 caller 抛 AUTH_REQUIRED）；
 * 真·空号（销号/私密/全删）走满重试后返回空快照，由下游 EmptyResultError 正确收尾。导出供测试。
 */
export async function readUserSnapshotHydrated(page, maxRetries = 8, waitSeconds = 2) {
    let snapshot = await readUserSnapshot(page);
    for (let i = 0; i < maxRetries && !isLoginWallSnapshot(snapshot) && countFlatNotes(snapshot) === 0; i += 1) {
        await page.wait({ time: waitSeconds });
        snapshot = await readUserSnapshot(page);
    }
    return snapshot;
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
        let snapshot = await readUserSnapshotHydrated(page);
        if (isLoginWallSnapshot(snapshot)) {
            // profile 页登录态失效 → 302 到 /login。绝不能误报成 "Malformed user store" /
            // EMPTY_RESULT —— 那会让下游（ml-scout 等）把登录失效当解析失败 / 空号，白等
            // rate-limit cooldown（实测 2026-06-09：风控把 profile 浏览态降级 → 整批 seed
            // 重定向到 /login）。抛 AUTH_REQUIRED，让 caller 提示用户重登 xiaohongshu.com。
            throwLoginWallAuthRequired();
        }
        assertReadableUserSnapshot(snapshot);
        let results = extractXhsUserNotes(snapshot ?? {}, userId);
        let previousCount = results.length;
        for (let i = 0; results.length < limit && i < 4; i += 1) {
            await page.autoScroll({ times: 1, delayMs: 1500 });
            await page.wait(1);
            snapshot = await readUserSnapshot(page);
            if (isLoginWallSnapshot(snapshot)) {
                throwLoginWallAuthRequired();
            }
            assertReadableUserSnapshot(snapshot);
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
