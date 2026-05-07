// Follow a TikTok user via in-page button click + state verification.
//
// Replaces the legacy pipeline-based adapter that returned silent failure
// rows like `{ status: 'Follow button not found', username }`. Route 1
// here is conservative: keep the live UI button as the trigger (TikTok's
// `/api/commit/follow/user/` requires X-Bogus signing — out of scope for
// this PR), but harden every transition with typed errors:
//
//   ArgumentError         — empty or malformed username
//   AuthRequiredError     — not logged in (no sessionid + no viewer secUid)
//   CommandExecutionError — button missing / state verification fails /
//                           rate limit detected (retryable=true since
//                           TikTok dedupes follow on retry)
//
// `result` row enum: `followed` / `already-following` / `already-friends`
// (mutual). Failures throw — never returned as a success row.

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    BROWSER_HELPERS,
    BUTTON_WALKER_HELPERS,
    RETRYABLE_HINTS,
    TIKTOK_HOST,
    normalizeUsername,
    throwButtonWalkerError,
} from './utils.js';

function buildFollowScript(username) {
    return `
(async () => {
  const username = ${JSON.stringify(username)};

  ${BROWSER_HELPERS}
  ${BUTTON_WALKER_HELPERS}

  ensureLoggedInOrThrow();
  ensureNoRateLimitOrThrow();

  const FOLLOW_LABELS = ['Follow', '关注', 'フォロー'];
  const FOLLOWING_LABELS = ['Following', '已关注', 'フォロー中'];
  const FRIENDS_LABELS = ['Friends', '互关', 'フレンド'];
  const ALREADY_LABELS = FOLLOWING_LABELS.concat(FRIENDS_LABELS);

  // Idempotent fast path: already in target state.
  if (buttonExists(FRIENDS_LABELS)) {
    return [{ username, url: ${JSON.stringify(TIKTOK_HOST)} + '/@' + encodeURIComponent(username), result: 'already-friends' }];
  }
  if (buttonExists(FOLLOWING_LABELS)) {
    return [{ username, url: ${JSON.stringify(TIKTOK_HOST)} + '/@' + encodeURIComponent(username), result: 'already-following' }];
  }

  const followBtn = findButtonByText(FOLLOW_LABELS);
  if (!followBtn) {
    throw new Error('BUTTON_NOT_FOUND: Follow button not on profile page (logged out, private account, or selectors changed)');
  }

  const target = followBtn.closest('button') || followBtn.closest('[role="button"]') || followBtn;
  target.click();

  // State verification: button text should flip to Following / 已关注 etc.
  const flipped = await waitFor(() => buttonExists(ALREADY_LABELS), { timeoutMs: 5000 });
  if (!flipped) {
    ensureNoRateLimitOrThrow();
    throw new Error('STATE_VERIFY_FAIL: follow button did not flip to Following within 5s; relation may not have been recorded');
  }

  // Re-check rate limit AFTER click — TikTok sometimes flashes captcha
  // mid-flight even when the button text appears to flip.
  ensureNoRateLimitOrThrow();

  return [{
    username,
    url: ${JSON.stringify(TIKTOK_HOST)} + '/@' + encodeURIComponent(username),
    result: 'followed',
  }];
})()
`;
}

async function followUser(page, args) {
    const username = normalizeUsername(args.username);
    const throwFailure = (error) => throwButtonWalkerError(error, {
        authMessage: 'TikTok requires login to follow users',
        failureMessage: `Failed to follow @${username}`,
        retryableHint: RETRYABLE_HINTS.relationFailure,
    });
    let rows;
    try {
        await page.goto(`${TIKTOK_HOST}/@${encodeURIComponent(username)}`, {
            waitUntil: 'load',
            settleMs: 5000,
        });
        rows = await page.evaluate(buildFollowScript(username));
    } catch (error) {
        throwFailure(error);
    }
    if (!Array.isArray(rows) || rows.length === 0) {
        // Defensive: build script always returns a row on success path.
        // If we land here, treat as state-verify failure.
        throwFailure(new Error(`STATE_VERIFY_FAIL: follow returned no row for @${username}`));
    }
    return rows;
}

export const followCommand = cli({
    site: 'tiktok',
    name: 'follow',
    access: 'write',
    description: 'Follow a TikTok user by username',
    domain: 'www.tiktok.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'username', required: true, positional: true, help: 'TikTok username (without @)' },
    ],
    columns: ['username', 'url', 'result'],
    func: followUser,
});

export const __test__ = {
    buildFollowScript,
};
