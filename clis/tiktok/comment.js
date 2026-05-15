// Post a comment on a TikTok video via in-page button click + state
// verification.
//
// Replaces the legacy pipeline-based adapter that returned a silent
// failure row `{ status: posted ? 'Commented' : 'Comment may have failed' }`.
// Route 1 keeps the live UI button + contenteditable input as the
// trigger (TikTok's `/api/comment/publish/` write endpoint requires
// X-Bogus signing — out of scope), and every transition raises a typed
// error:
//
//   ArgumentError         — empty / overlong text, malformed video URL
//   AuthRequiredError     — not logged in
//   CommandExecutionError — comment input / post button missing /
//                           state verification fails / rate limit
//                           detected (retryable=false: TikTok may have
//                           accepted the comment server-side even when
//                           our state-verify timed out)
//
// `result` row enum: `posted`. There is no idempotent fast path: TikTok
// allows multiple identical comments, so we cannot safely "detect"
// already-posted by scanning the existing list. Failures throw — never
// returned as a success row.

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    BROWSER_HELPERS,
    BUTTON_WALKER_HELPERS,
    RETRYABLE_HINTS,
    parseTikTokVideoUrl,
    requireCommentText,
    throwButtonWalkerError,
} from './utils.js';

function buildCommentScript(commentText) {
    return `
(async () => {
  const commentText = ${JSON.stringify(commentText)};

  ${BROWSER_HELPERS}
  ${BUTTON_WALKER_HELPERS}

  ensureLoggedInOrThrow();
  ensureNoRateLimitOrThrow();

  // Expand the comment panel if it is collapsed (vertical feed pages).
  const commentIcon = document.querySelector('[data-e2e="comment-icon"]');
  if (commentIcon) {
    const cBtn = commentIcon.closest('button') || commentIcon.closest('[role="button"]') || commentIcon;
    cBtn.click();
    await waitFor(() => Boolean(
      document.querySelector('[data-e2e="comment-input"] [contenteditable="true"]')
    ), { timeoutMs: 4000 });
  }

  const beforeCount = document.querySelectorAll('[data-e2e="comment-level-1"]').length;

  const input = document.querySelector('[data-e2e="comment-input"] [contenteditable="true"]')
    || document.querySelector('[contenteditable="true"]');
  if (!input) {
    throw new Error('BUTTON_NOT_FOUND: comment input not found (page not rendered, comments disabled, or selectors changed)');
  }

  input.focus();
  // execCommand is deprecated but still the only reliable way to inject
  // text into TikTok's contenteditable so its React tree picks up the
  // value; replicating with InputEvent fires but TikTok ignores it.
  document.execCommand('insertText', false, commentText);

  // Wait for the post button to become enabled — TikTok disables it
  // until non-empty text is detected by their input handler.
  const postReady = await waitFor(() => {
    const candidate = findButtonByText(['Post', '发布', '发送']);
    if (!candidate) return false;
    const ariaDisabled = candidate.getAttribute && candidate.getAttribute('aria-disabled');
    return !candidate.disabled && ariaDisabled !== 'true';
  }, { timeoutMs: 4000 });
  if (!postReady) {
    ensureNoRateLimitOrThrow();
    throw new Error('BUTTON_NOT_FOUND: Post button never became enabled (text not registered or selectors changed)');
  }

  const postBtn = findButtonByText(['Post', '发布', '发送']);
  postBtn.click();

  // State verification: a new comment-level-1 element should appear.
  const flipped = await waitFor(
    () => document.querySelectorAll('[data-e2e="comment-level-1"]').length > beforeCount,
    { timeoutMs: 8000 },
  );
  if (!flipped) {
    ensureNoRateLimitOrThrow();
    throw new Error('STATE_VERIFY_FAIL: comment count did not increase within 8s; comment may or may not have been recorded server-side');
  }

  ensureNoRateLimitOrThrow();

  return [{
    url: location.href,
    text: commentText,
    result: 'posted',
  }];
})()
`;
}

async function postComment(page, args) {
    const { url } = parseTikTokVideoUrl(args.url);
    const text = requireCommentText(args.text);
    const throwFailure = (error) => throwButtonWalkerError(error, {
        authMessage: 'TikTok requires login to post comments',
        failureMessage: `Failed to post comment on ${url}`,
        retryableHint: RETRYABLE_HINTS.commentFailure,
    });
    let rows;
    try {
        await page.goto(url, { waitUntil: 'load', settleMs: 6000 });
        rows = await page.evaluate(buildCommentScript(text));
    } catch (error) {
        throwFailure(error);
    }
    if (!Array.isArray(rows) || rows.length === 0) {
        throwFailure(new Error(`STATE_VERIFY_FAIL: comment returned no row for ${url}`));
    }
    return rows;
}

export const commentCommand = cli({
    site: 'tiktok',
    name: 'comment',
    access: 'write',
    description: 'Post a comment on a TikTok video',
    domain: 'www.tiktok.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'url', required: true, positional: true, help: 'TikTok video URL (https://www.tiktok.com/@user/video/<id>)' },
        { name: 'text', required: true, positional: true, help: 'Comment text (≤150 chars)' },
    ],
    columns: ['url', 'text', 'result'],
    func: postComment,
});

export const __test__ = {
    buildCommentScript,
};
