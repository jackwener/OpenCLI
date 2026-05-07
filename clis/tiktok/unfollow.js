// Unfollow a TikTok user via in-page button click + state verification.
//
// Replaces the legacy pipeline-based adapter that returned silent failure
// rows like `{ status: 'Not following this user', username }`. Route 1
// keeps the live UI button + confirm-dialog flow (the page-context
// `/api/commit/follow/user/` write endpoint requires X-Bogus signing —
// out of scope for this PR), but every transition raises a typed error:
//
//   ArgumentError         — empty or malformed username
//   AuthRequiredError     — not logged in
//   CommandExecutionError — Following button missing / confirm dialog
//                           missing / state verification fails / rate
//                           limit detected (retryable=true: server-side
//                           dedupes unfollow on retry)
//
// `result` row enum: `unfollowed` / `already-not-following`. Failures
// throw — never returned as a success row.

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    BROWSER_HELPERS,
    BUTTON_WALKER_HELPERS,
    RETRYABLE_HINTS,
    TIKTOK_HOST,
    normalizeUsername,
    throwButtonWalkerError,
} from './utils.js';

function buildUnfollowScript(username) {
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
  const RELATION_LABELS = FOLLOWING_LABELS.concat(FRIENDS_LABELS);
  const CONFIRM_LABELS = ['Unfollow', '取消关注'];

  // Idempotent fast path: not currently following.
  if (!buttonExists(RELATION_LABELS) && buttonExists(FOLLOW_LABELS)) {
    return [{ username, url: ${JSON.stringify(TIKTOK_HOST)} + '/@' + encodeURIComponent(username), result: 'already-not-following' }];
  }

  const relationBtn = findButtonByText(RELATION_LABELS);
  if (!relationBtn) {
    // Neither Follow nor Following — page may not have rendered, or
    // private account / blocked: refuse to silently succeed.
    throw new Error('BUTTON_NOT_FOUND: neither Follow nor Following button found (page not rendered, blocked, or selectors changed)');
  }

  const target = relationBtn.closest('button') || relationBtn.closest('[role="button"]') || relationBtn;
  target.click();

  // TikTok shows a confirm-unfollow dialog. Wait for it to render.
  const dialogShown = await waitFor(() => buttonExists(CONFIRM_LABELS), { timeoutMs: 3000 });
  if (dialogShown) {
    const confirmBtn = findButtonByText(CONFIRM_LABELS);
    if (!confirmBtn) {
      throw new Error('BUTTON_NOT_FOUND: confirm-unfollow dialog detected but confirm button could not be located');
    }
    confirmBtn.click();
  }

  const flipped = await waitFor(
    () => buttonExists(FOLLOW_LABELS) && !buttonExists(RELATION_LABELS),
    { timeoutMs: 5000 },
  );
  if (!flipped) {
    ensureNoRateLimitOrThrow();
    throw new Error('STATE_VERIFY_FAIL: relation did not flip back to Follow within 5s; unfollow may not have been recorded');
  }

  ensureNoRateLimitOrThrow();

  return [{
    username,
    url: ${JSON.stringify(TIKTOK_HOST)} + '/@' + encodeURIComponent(username),
    result: 'unfollowed',
  }];
})()
`;
}

async function unfollowUser(page, args) {
    const username = normalizeUsername(args.username);
    const throwFailure = (error) => throwButtonWalkerError(error, {
        authMessage: 'TikTok requires login to unfollow users',
        failureMessage: `Failed to unfollow @${username}`,
        retryableHint: RETRYABLE_HINTS.relationFailure,
    });
    let rows;
    try {
        await page.goto(`${TIKTOK_HOST}/@${encodeURIComponent(username)}`, {
            waitUntil: 'load',
            settleMs: 5000,
        });
        rows = await page.evaluate(buildUnfollowScript(username));
    } catch (error) {
        throwFailure(error);
    }
    if (!Array.isArray(rows) || rows.length === 0) {
        throwFailure(new Error(`STATE_VERIFY_FAIL: unfollow returned no row for @${username}`));
    }
    return rows;
}

export const unfollowCommand = cli({
    site: 'tiktok',
    name: 'unfollow',
    access: 'write',
    description: 'Unfollow a TikTok user by username',
    domain: 'www.tiktok.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'username', required: true, positional: true, help: 'TikTok username (without @)' },
    ],
    columns: ['username', 'url', 'result'],
    func: unfollowUser,
});

export const __test__ = {
    buildUnfollowScript,
};
