/**
 * Xiaohongshu user search (`xiaohongshu search <q> --type user`).
 *
 * The web app's search page has a "用户" tab backed by
 * POST /api/sns/web/v1/search/usersearch. Instead of replaying that signed
 * request we drive the page's own `search` Pinia store:
 *
 *   store.searchUserContext = { keyword, searchId, page, pageSize, bizType, requestId }
 *   await store.getUserLists(searchId)   // page 1 → store.userLists
 *   await store.loadMoreUsers()          // page+1, appends to store.userLists
 *
 * See pinia-helpers.js for why the store path is used.
 */
import { ArgumentError, AuthRequiredError, CliError, CommandExecutionError, EmptyResultError, TimeoutError } from '@jackwener/opencli/errors';
import { buildWaitForStoreJs, normalizeXhsAvatar, parseXhsCount, PINIA_ACCESS_JS, xhsProfileUrl } from './pinia-helpers.js';
import { unwrapEvaluateResult } from './shared.js';

const STORE_WAIT_MS = 8000;
const PAGE_SIZE = 20;
const MAX_PAGES = 10;

/**
 * Map one raw `search.userLists[]` entry (camelCase, as exposed by the store)
 * into the documented CLI row. Unknown fields become `null`, never omitted.
 */
export function mapXhsSearchUser(raw, index, webHost = 'www.xiaohongshu.com') {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const userId = String(raw.id ?? raw.userId ?? raw.user_id ?? '').trim();
    if (!userId) {
        return null;
    }
    const nickname = String(raw.name ?? raw.nickname ?? raw.nickName ?? '').trim();
    const redId = String(raw.redId ?? raw.red_id ?? '').trim() || null;
    // `subTitle` is the bio when the account has one, otherwise the
    // "小红书号：xxx" placeholder. Only keep it as desc when it is a real bio.
    const subTitle = String(raw.subTitle ?? raw.sub_title ?? raw.desc ?? '').trim();
    const desc = subTitle && !/^小红书号[:：]/.test(subTitle) ? subTitle : null;
    return {
        rank: index + 1,
        // `title` mirrors nickname so the shared table columns stay readable.
        title: nickname,
        user_id: userId,
        nickname,
        red_id: redId,
        avatar: normalizeXhsAvatar(raw.image ?? raw.avatar ?? raw.images),
        desc,
        fans: parseXhsCount(raw.fans ?? raw.fansCount ?? raw.fans_count),
        notes_count: parseXhsCount(raw.noteCount ?? raw.note_count ?? raw.notes_count),
        followed: typeof raw.followed === 'boolean' ? raw.followed : null,
        url: xhsProfileUrl(userId, webHost),
    };
}

export function buildUserSearchJs(keyword, limit, options = {}) {
    const pageSize = options.pageSize ?? PAGE_SIZE;
    const maxPages = options.maxPages ?? MAX_PAGES;
    if (typeof keyword !== 'string' || !keyword.trim()) {
        throw new ArgumentError('xiaohongshu search --type user requires a non-empty keyword');
    }
    if (!Number.isSafeInteger(limit) || limit < 1) {
        throw new ArgumentError(`limit must be a positive integer, got ${JSON.stringify(limit)}`);
    }
    return `
    (async () => {
      ${PINIA_ACCESS_JS}
      const keyword = ${JSON.stringify(keyword)};
      const limit = ${limit};
      const pageSize = ${pageSize};
      const maxPages = ${maxPages};
      if (__xhsLoggedOut()) return { status: 'login_wall' };
      const store = __xhsStore('search');
      if (!store) return { status: 'no_store' };
      if (typeof store.getUserLists !== 'function' || !store.searchUserContext || typeof store.searchUserContext !== 'object') {
        return { status: 'no_action' };
      }
      const ctx = store.searchUserContext;
      if (typeof store.resetSearchUserStore === 'function') {
        try { store.resetSearchUserStore(); } catch {}
      }
      const searchId = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      ctx.keyword = keyword;
      ctx.page = 1;
      ctx.pageSize = pageSize;
      ctx.searchId = searchId;
      let error = null;
      try {
        await store.getUserLists(searchId);
      } catch (err) {
        error = String((err && (err.message || err.msg)) || err);
      }
      const list = () => Array.isArray(store.userLists) ? store.userLists : [];
      let pages = 1;
      while (!error && list().length < limit && pages < maxPages
             && store.fetchUserListsStatus === 'success' && store.hasMoreUser
             && typeof store.loadMoreUsers === 'function') {
        const before = list().length;
        try {
          await store.loadMoreUsers();
        } catch (err) {
          error = String((err && (err.message || err.msg)) || err);
          break;
        }
        pages++;
        if (list().length <= before) break;
      }
      const bodyText = (document.body && document.body.innerText) || '';
      return {
        status: String(store.fetchUserListsStatus || ''),
        error,
        securityBlock: /请求太频繁|访问频次异常|安全限制/.test(bodyText),
        loginWall: __xhsLoggedOut(),
        users: __xhsClone(list()).slice(0, limit),
        pages,
      };
    })()
  `;
}

function requireUserSearchPayload(payload) {
    const result = unwrapEvaluateResult(payload);
    if (!result || typeof result !== 'object' || Array.isArray(result) || typeof result.status !== 'string') {
        throw new CommandExecutionError('Unexpected Xiaohongshu user search payload shape.');
    }
    return result;
}

export async function searchXhsUsers(page, keyword, limit, webHost = 'www.xiaohongshu.com') {
    const url = `https://${webHost}/search_result?keyword=${encodeURIComponent(keyword)}&source=web_explore_feed`;
    await page.goto(url);
    const ready = unwrapEvaluateResult(await page.evaluate(buildWaitForStoreJs('search', STORE_WAIT_MS)));
    if (ready !== 'ready') {
        throw new TimeoutError('xiaohongshu search store', STORE_WAIT_MS / 1000, 'The Xiaohongshu app did not finish bootstrapping; retry or check the logged-in browser session.');
    }
    const result = requireUserSearchPayload(await page.evaluate(buildUserSearchJs(keyword, limit)));
    if (result.status === 'login_wall' || result.loginWall === true) {
        throw new AuthRequiredError(webHost, 'Xiaohongshu user search requires a logged-in browser session');
    }
    if (result.status === 'no_store' || result.status === 'no_action') {
        throw new CommandExecutionError(
            `Xiaohongshu search store is unavailable (${result.status}); the site bundle may have changed.`,
            'Update opencli or report this with `opencli xiaohongshu search <q> --type user --verbose`.',
        );
    }
    if (result.securityBlock === true) {
        throw new CliError('SECURITY_BLOCK', 'Xiaohongshu user search was blocked by request-frequency or security controls.', 'Wait before retrying or use a different logged-in browser session.');
    }
    if (result.error) {
        throw new CommandExecutionError(`Xiaohongshu user search failed: ${result.error}`);
    }
    const rows = (Array.isArray(result.users) ? result.users : [])
        .map((raw, index) => mapXhsSearchUser(raw, index, webHost))
        .filter(Boolean)
        .slice(0, limit);
    if (rows.length === 0) {
        throw new EmptyResultError('xiaohongshu search --type user', `No users matched ${JSON.stringify(keyword)}.`);
    }
    return rows;
}

export const XHS_USER_SEARCH_COLUMNS = ['rank', 'title', 'user_id', 'nickname', 'red_id', 'avatar', 'desc', 'fans', 'notes_count', 'followed', 'url'];

export const __test__ = { PAGE_SIZE, MAX_PAGES, STORE_WAIT_MS };
