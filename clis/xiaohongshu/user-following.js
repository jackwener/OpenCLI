/**
 * Xiaohongshu user-following — accounts a user follows.
 *
 * Reality check on what the web app exposes (verified 2026-09-05 by grepping
 * every xhs-pc-web bundle for the API layer):
 *
 *   - There is NO web endpoint for another user's following list. The
 *     profile page renders the "关注 N" counter as plain text (clicking it
 *     does nothing and fires no request), and the API module only defines
 *     `/api/im/web/users/following/all` — the *logged-in* user's own list,
 *     fetched by the IM widget on every page load.
 *
 * So this command:
 *   - with no user id, or with the logged-in user's own id → returns the own
 *     following list by capturing the IM request the page itself makes
 *     (extension-level network capture, so the signed headers stay the
 *     page's own business);
 *   - with another user's id → `ArgumentError` before any capture starts,
 *     explaining that xhs web never exposes other users' lists.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';
import { normalizeXhsAvatar, PINIA_ACCESS_JS, requireXhsUserId, xhsProfileUrl } from './pinia-helpers.js';
import { unwrapEvaluateResult } from './shared.js';

const IM_FOLLOWING_PATH = '/api/im/web/users/following/all';
const CAPTURE_TIMEOUT_SECONDS = 20;
const CAPTURE_POLL_SECONDS = 1;
const MAX_LIMIT = 2000;

const SELF_ID_JS = `
  (() => {
    ${PINIA_ACCESS_JS}
    const store = __xhsStore('user');
    const info = store ? __xhsClone(store.userInfo) : null;
    const state = (window.__INITIAL_STATE__ && window.__INITIAL_STATE__.user) || null;
    const fallback = state && state.userInfo ? __xhsClone(state.userInfo._value !== undefined ? state.userInfo._value : state.userInfo) : null;
    const picked = info || fallback || {};
    return {
      loggedOut: __xhsLoggedOut(),
      userId: String(picked.userId || picked.user_id || ''),
      guest: picked.guest === true,
    };
  })()
`;

export function parseLimit(raw) {
    const parsed = Number(raw ?? 200);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
        throw new ArgumentError(`--limit must be an integer between 1 and ${MAX_LIMIT}, got ${JSON.stringify(raw)}`);
    }
    return parsed;
}

function readCaptureBody(entry) {
    const preview = entry?.responsePreview;
    if (typeof preview === 'string') {
        if (preview.startsWith('base64:')) {
            return null;
        }
        try {
            return JSON.parse(preview);
        }
        catch {
            return null;
        }
    }
    return preview && typeof preview === 'object' ? preview : null;
}

function pageNumberOf(url) {
    try {
        return Number(new URL(String(url)).searchParams.get('page') || '0');
    }
    catch {
        return 0;
    }
}

/**
 * Map one IM `follow_user_d_t_o_list[]` entry into the documented row.
 * The IM payload carries no bio or follower count, so those are `null`.
 */
export function mapXhsFollowing(raw, webHost = 'www.xiaohongshu.com') {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const userId = String(raw.user_id ?? raw.userId ?? '').trim();
    if (!userId) {
        return null;
    }
    return {
        user_id: userId,
        nickname: String(raw.nick_name ?? raw.nickname ?? raw.nickName ?? raw.name ?? '').trim(),
        desc: null,
        fans: null,
        avatar: normalizeXhsAvatar(raw.avatar ?? raw.image ?? raw.images),
        url: xhsProfileUrl(userId, webHost),
    };
}

/**
 * Collapse captured IM responses into ordered rows. Returns
 * `{ rows, complete }` where `complete` is true once a page with an empty
 * list was observed (the IM widget always requests until it gets one).
 */
export function collectFollowingFromCapture(entries, seenPages, acc, webHost = 'www.xiaohongshu.com') {
    let complete = false;
    for (const entry of Array.isArray(entries) ? entries : []) {
        if (!entry || typeof entry.url !== 'string' || !entry.url.includes(IM_FOLLOWING_PATH)) {
            continue;
        }
        const body = readCaptureBody(entry);
        if (!body || typeof body !== 'object') {
            continue;
        }
        const pageNo = pageNumberOf(entry.url);
        if (seenPages.has(pageNo)) {
            continue;
        }
        seenPages.add(pageNo);
        const list = Array.isArray(body?.data?.follow_user_d_t_o_list) ? body.data.follow_user_d_t_o_list : null;
        if (!list) {
            continue;
        }
        if (list.length === 0) {
            complete = true;
        }
        for (const raw of list) {
            const row = mapXhsFollowing(raw, webHost);
            if (row && !acc.has(row.user_id)) {
                acc.set(row.user_id, row);
            }
        }
    }
    return { rows: Array.from(acc.values()), complete };
}

async function fetchOwnFollowing(page, selfId, limit, webHost) {
    if (typeof page.startNetworkCapture !== 'function' || typeof page.readNetworkCapture !== 'function') {
        throw new CommandExecutionError(
            'xiaohongshu user-following needs extension-level network capture, which this browser session does not provide.',
            'Update the Browser Bridge extension and retry.',
        );
    }
    const started = await page.startNetworkCapture(IM_FOLLOWING_PATH);
    if (started === false) {
        throw new CommandExecutionError(
            'Browser Bridge extension does not support network capture; cannot read the following list.',
            'Update the Browser Bridge extension and retry.',
        );
    }
    // Any page with the IM widget triggers the request; the own profile is
    // the natural surface and also confirms the session is still logged in.
    await page.goto(xhsProfileUrl(selfId, webHost));
    const acc = new Map();
    const seenPages = new Set();
    const deadline = Date.now() + CAPTURE_TIMEOUT_SECONDS * 1000;
    let complete = false;
    while (Date.now() < deadline) {
        const entries = await page.readNetworkCapture();
        const result = collectFollowingFromCapture(entries, seenPages, acc, webHost);
        complete = result.complete;
        if (complete || acc.size >= limit) {
            break;
        }
        await page.wait({ time: CAPTURE_POLL_SECONDS });
    }
    if (acc.size === 0 && !complete) {
        throw new TimeoutError('xiaohongshu user-following (IM following capture)', CAPTURE_TIMEOUT_SECONDS, 'The page did not request its following list; make sure the browser session is logged in and retry.');
    }
    return Array.from(acc.values()).slice(0, limit);
}

cli({
    site: 'xiaohongshu',
    name: 'user-following',
    access: 'read',
    description: '小红书关注列表（仅限当前登录账号；web 端不提供他人的关注列表）',
    domain: 'www.xiaohongshu.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'user-id', type: 'string', required: false, positional: true, help: 'Optional. Omit for the logged-in user; passing your own ID or profile URL is equivalent. Other users are rejected because the web app has no endpoint for their lists.' },
        { name: 'limit', type: 'int', default: 200, help: `Maximum rows to return (1-${MAX_LIMIT})` },
    ],
    columns: ['user_id', 'nickname', 'desc', 'fans', 'avatar', 'url'],
    func: async (page, kwargs) => {
        const limit = parseLimit(kwargs.limit);
        const rawTarget = String(kwargs['user-id'] ?? '').trim();
        const target = rawTarget ? requireXhsUserId(rawTarget, 'xiaohongshu/user-following') : '';
        const webHost = 'www.xiaohongshu.com';

        await page.goto(`https://${webHost}/explore`);
        const self = unwrapEvaluateResult(await page.evaluate(SELF_ID_JS));
        if (!self || typeof self !== 'object' || typeof self.userId !== 'string') {
            throw new CommandExecutionError('xiaohongshu/user-following: malformed self-identity payload');
        }
        if (self.loggedOut === true || self.guest === true || !self.userId) {
            throw new AuthRequiredError(webHost, 'Xiaohongshu following list requires a logged-in browser session');
        }
        if (target && target !== self.userId) {
            throw new ArgumentError(
                `xiaohongshu web does not expose other users' following lists (user ${target}).`,
                'Omit user-id to list the accounts the logged-in user follows.',
            );
        }
        return await fetchOwnFollowing(page, self.userId, limit, webHost);
    },
});

export const __test__ = { IM_FOLLOWING_PATH, CAPTURE_TIMEOUT_SECONDS, readCaptureBody, pageNumberOf };
