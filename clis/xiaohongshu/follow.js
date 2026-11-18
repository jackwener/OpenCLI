/**
 * Xiaohongshu follow — follow a user through the page's own `user` store.
 *
 * Previous approach (clicking the profile "关注" button) failed 0/7 in real
 * runs: the click is intercepted by a modal and the button text never flips.
 * xhs public web APIs require `x-s`/`x-t`/`x-s-common` signing that only the
 * page's axios instance produces correctly, so we go through the Pinia
 * `user` store, whose `toFollow({ targetUserId })` action is exactly what the
 * app calls for POST /api/sns/web/v1/user/follow.
 *
 * Flow:
 *   1. Navigate to https://www.xiaohongshu.com/user/profile/<userId>
 *   2. Detect login redirect (xhs bounces to /login on auth failure)
 *   3. Read `userPageData.extraInfo.fstatus` — 'follows' | 'both' means the
 *      viewer already follows the target → return already_following:true
 *      without issuing a write (the command is not idempotent server-side).
 *   4. Call `store.toFollow({ targetUserId })` and read the `fstatus` the
 *      follow API itself returns — that is the authoritative answer.
 *   5. When the API response carries no state, re-read it from a genuinely
 *      fresh profile render (see `refetchFollowStatus`).
 *
 * A follow that the API accepted is reported as a success even when step 5
 * stays inconclusive (`verified: false` + a stderr note). This command is not
 * idempotent, so reporting a landed write as a failure is the worst outcome:
 * the caller retries and follows the account twice.
 *
 * Requires: logged into www.xiaohongshu.com in Chrome.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CliError, CommandExecutionError } from '@jackwener/opencli/errors';
import { isXiaohongshuHost, PINIA_ACCESS_JS, requireXhsUserId, xhsProfileUrl } from './pinia-helpers.js';
import { unwrapEvaluateResult } from './shared.js';

const PROFILE_SETTLE_MS = 2500;
const VERIFY_RETRIES = 4;
const VERIFY_WAIT_SECONDS = 1;
/** Rounds of "leave the page, come back, re-read" used to defeat the SPA cache. */
const REFETCH_ROUNDS = 2;
const FOLLOWING_STATES = new Set(['follows', 'both']);
export const UNVERIFIED_MARKER = 'FOLLOW_UNVERIFIED';

function requireActionResult(payload, context) {
    const inner = unwrapEvaluateResult(payload);
    if (!inner || typeof inner !== 'object' || Array.isArray(inner) || typeof inner.ok !== 'boolean') {
        throw new CommandExecutionError(`xiaohongshu/follow: malformed ${context} payload`);
    }
    return inner;
}

function assertUserId(raw) {
    return requireXhsUserId(raw, 'xiaohongshu/follow');
}

/**
 * Browser-side: read the follow relation from the `user` store. Returns
 * `{ ok, fstatus, reason? }` where fstatus is 'none' | 'follows' | 'fans' |
 * 'both' | null (null = store not hydrated yet).
 */
function buildReadStatusScript() {
    return `
(() => {
  ${PINIA_ACCESS_JS}
  if (__xhsLoggedOut()) return { ok: false, reason: 'login_wall' };
  const store = __xhsStore('user');
  if (!store) return { ok: false, reason: 'store_unavailable' };
  const pageData = __xhsClone(store.userPageData) || {};
  const fstatus = pageData.extraInfo && typeof pageData.extraInfo.fstatus === 'string' ? pageData.extraInfo.fstatus : null;
  return { ok: true, fstatus, hydrated: Boolean(pageData.basicInfo && Object.keys(pageData.basicInfo).length) };
})()
`;
}

/**
 * Browser-side: issue the follow through the store action. Returns
 * `{ ok, state, reason?, response? }` with state 'followed' | 'failed'.
 */
function buildFollowScript(userId) {
    return `
(async () => {
  ${PINIA_ACCESS_JS}
  const targetUserId = ${JSON.stringify(userId)};
  if (__xhsLoggedOut()) return { ok: false, state: 'failed', reason: 'login_wall' };
  const store = __xhsStore('user');
  if (!store) return { ok: false, state: 'failed', reason: 'store_unavailable' };
  if (typeof store.toFollow !== 'function') return { ok: false, state: 'failed', reason: 'action_unavailable' };
  try {
    const response = __xhsClone(await store.toFollow({ targetUserId }));
    // POST /api/sns/web/v1/user/follow answers with the resulting relation.
    // Depending on the axios interceptor the body may arrive unwrapped or
    // still nested under a data property, so read both shapes.
    const payload = response && typeof response === 'object' ? response : {};
    const inner = payload.data && typeof payload.data === 'object' ? payload.data : {};
    const fstatus = typeof payload.fstatus === 'string' ? payload.fstatus
      : typeof inner.fstatus === 'string' ? inner.fstatus : null;
    return { ok: true, state: 'followed', fstatus, response: payload };
  } catch (err) {
    const data = err && err.data ? __xhsClone(err.data) : null;
    const code = (data && (data.code !== undefined ? data.code : data.result && data.result.code)) ?? (err && err.code);
    const msg = (data && (data.msg || data.message)) || (err && (err.msg || err.message)) || String(err);
    return { ok: false, state: 'failed', reason: 'api_error', code: code === undefined ? null : code, message: String(msg) };
  }
})()
`;
}

async function readCurrentProfileHref(page, userId) {
    const hrefRaw = unwrapEvaluateResult(await page.evaluate('() => location.href'));
    if (typeof hrefRaw !== 'string') {
        throw new CommandExecutionError('xiaohongshu/follow: malformed current-url payload');
    }
    const parsedHref = new URL(hrefRaw);
    if (parsedHref.protocol !== 'https:' || !isXiaohongshuHost(parsedHref.hostname)) {
        throw new CommandExecutionError(`xiaohongshu/follow: expected Xiaohongshu profile host, got ${parsedHref.hostname}`);
    }
    if (/\/login(?:[/?#]|$)/i.test(parsedHref.pathname)) {
        throw new AuthRequiredError('www.xiaohongshu.com');
    }
    const currentProfile = parsedHref.pathname.match(/^\/user\/profile\/([a-zA-Z0-9]{8,32})\/?$/);
    if (currentProfile?.[1] !== userId) {
        throw new CommandExecutionError(`xiaohongshu/follow: expected profile ${userId}, got ${parsedHref.pathname}`);
    }
}

/**
 * Read `fstatus` from the store, retrying while the page is still hydrating.
 *
 * `awaitFollowing` also keeps polling once hydrated but the relation still
 * reads a non-following state: after a successful follow the SPA can hold the
 * pre-follow `userPageData` for a moment, so a single read races the refresh.
 */
async function readFollowStatus(page, retries = VERIFY_RETRIES, awaitFollowing = false) {
    let result = requireActionResult(await page.evaluate(buildReadStatusScript()), 'follow-status');
    for (let i = 0; i < retries && result.ok; i += 1) {
        const settled = result.hydrated && (!awaitFollowing || isFollowingState(result.fstatus));
        if (settled) break;
        await page.wait({ time: VERIFY_WAIT_SECONDS });
        result = requireActionResult(await page.evaluate(buildReadStatusScript()), 'follow-status');
    }
    if (!result.ok) {
        if (result.reason === 'login_wall') {
            throw new AuthRequiredError('www.xiaohongshu.com');
        }
        const reason = typeof result.reason === 'string' && result.reason ? result.reason : 'unspecified';
        throw new CommandExecutionError(
            `xiaohongshu/follow: user store unavailable (${reason}); the site bundle may have changed.`,
            'Update opencli or report this with `opencli xiaohongshu follow <id> --verbose`.',
        );
    }
    return typeof result.fstatus === 'string' ? result.fstatus : null;
}

/**
 * Re-read the relation from a genuinely fresh profile render.
 *
 * `page.goto(<same url>)` is a soft navigation in this SPA: the profile
 * component never remounts, so `userPageData` keeps the pre-follow snapshot
 * and the relation reads `none` forever (observed 2026-09-05: a follow that
 * had actually landed was reported as a failure). Bouncing through /explore
 * unmounts it, so coming back forces a real refetch.
 */
async function refetchFollowStatus(page, profileUrl) {
    let fstatus = null;
    for (let round = 0; round < REFETCH_ROUNDS; round += 1) {
        await page.goto('https://www.xiaohongshu.com/explore');
        await page.wait({ time: VERIFY_WAIT_SECONDS });
        await page.goto(profileUrl);
        await page.wait({ time: PROFILE_SETTLE_MS / 1000 });
        fstatus = await readFollowStatus(page, VERIFY_RETRIES, true);
        if (isFollowingState(fstatus)) return fstatus;
    }
    return fstatus;
}

export function isFollowingState(fstatus) {
    return typeof fstatus === 'string' && FOLLOWING_STATES.has(fstatus);
}

cli({
    site: 'xiaohongshu',
    name: 'follow',
    access: 'write',
    description: '关注小红书用户（走页面 store 的 toFollow 接口，已关注时返回 already_following=true 而不报错）',
    domain: 'www.xiaohongshu.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    browser: true,
    args: [
        {
            name: 'user-id',
            required: true,
            positional: true,
            help: 'User ID (e.g. 5d8f88dc0000000001005d3a) or profile URL',
        },
    ],
    columns: ['ok', 'user_id', 'already_following', 'status', 'verified', 'url'],
    func: async (page, kwargs) => {
        if (!page) {
            throw new CommandExecutionError('Browser session required for xiaohongshu follow');
        }
        try {
            const userId = assertUserId(kwargs['user-id']);
            const url = xhsProfileUrl(userId);
            await page.goto(url);
            await page.wait({ time: PROFILE_SETTLE_MS / 1000 });
            await readCurrentProfileHref(page, userId);

            const before = await readFollowStatus(page);
            if (isFollowingState(before)) {
                return [{ ok: true, user_id: userId, already_following: true, status: 'already-following', verified: true, url }];
            }

            const result = requireActionResult(await page.evaluate(buildFollowScript(userId)), 'follow-action');
            if (!result.ok) {
                if (result.reason === 'login_wall') {
                    throw new AuthRequiredError('www.xiaohongshu.com');
                }
                const detail = result.reason === 'api_error'
                    ? `${result.message ?? 'unknown API error'}${result.code !== null && result.code !== undefined ? ` (code ${result.code})` : ''}`
                    : `${result.reason ?? 'unknown reason'}`;
                throw new CommandExecutionError(`xiaohongshu/follow failed: ${detail}`);
            }

            // The follow API answers with the resulting relation; that beats
            // anything read back off the page.
            let after = typeof result.fstatus === 'string' ? result.fstatus : null;
            if (!isFollowingState(after)) {
                after = await refetchFollowStatus(page, url);
            }
            const verified = isFollowingState(after);
            if (!verified) {
                // The write was accepted; only the read-back is inconclusive
                // (xhs relation propagation lags, and the SPA serves a cached
                // profile). Never downgrade that to a failure — a retry of a
                // non-idempotent write is worse than an unverified success.
                process.stderr.write(`${UNVERIFIED_MARKER}\n`);
                process.stderr.write(
                    `xiaohongshu/follow: the follow request was accepted but the relation still reads ${JSON.stringify(after)}; verify ${url} in the browser before retrying.\n`,
                );
            }
            return [{
                ok: true,
                user_id: userId,
                already_following: false,
                status: verified ? 'followed' : 'followed-unverified',
                verified,
                url,
            }];
        }
        catch (err) {
            if (err instanceof CliError) throw err;
            throw new CommandExecutionError(`xiaohongshu/follow failed: ${err?.message ?? String(err)}`);
        }
    },
});

export const __test__ = {
    assertUserId,
    buildFollowScript,
    buildReadStatusScript,
};
