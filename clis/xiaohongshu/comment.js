/**
 * Xiaohongshu comment — post a top-level comment on a note through the page's
 * own signed request layer.
 *
 * Why not a plain fetch: xhs web APIs need `x-s` / `x-t` / `x-s-common`
 * headers that only the app's axios instance produces (see pinia-helpers.js).
 * Why not a Pinia action, the way `follow` does it: there is none. Probing a
 * logged-in note page (2026-09-13) dumped every store in `$pinia._s` — `note`
 * carries only comment *view* state (`commentTarget`, `topCommentId`,
 * `forceScrollToComment`), and the sole comment-writing action anywhere,
 * `notification.replyComment`, belongs to the notifications page. The note
 * page's comment box calls a bundled API module directly, so this command
 * reaches that module through webpack's runtime and calls the function that
 * posts to /api/sns/web/v1/comment/post — the same wrapper the UI uses
 * (`postApiSnsWebV1CommentPost(body, opts)`), so every signature header is
 * attached for us. The function is located by matching the endpoint in its
 * source rather than by its minified export name, which changes on every xhs
 * build.
 *
 * Why not click the send button: the same lesson `follow` / `unfollow`
 * learned — modals and overlays intercept clicks on this SPA, and a click that
 * silently does nothing is indistinguishable from one that posted.
 *
 * Flow:
 *   1. Refuse without --execute, before any navigation or request.
 *   2. Navigate to the note through `readXhsDetailPage`, which paces the load
 *      and retries once through a cooldown when risk control soft-blocks it.
 *   3. Post exactly once. Never retry: a retried comment is a duplicate
 *      comment, and xhs offers the caller no undo.
 *
 * When xhs accepts the write but the response carries no comment id, the row
 * is still reported as posted with `verified: false` plus a
 * `COMMENT_UNVERIFIED` line on stderr — callers must read that as "sent, go
 * check", never as a failure to retry. The create API answers with the comment
 * it just made, so that response *is* the read-back; scraping the comment list
 * instead would risk reporting a landed write as a failure (the trap `follow`
 * fell into with the SPA's cached profile).
 *
 * Requires: logged into www.xiaohongshu.com in Chrome.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CliError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { parseNoteId } from './note-helpers.js';
import {
    buildSignedApiFinderJs,
    COMMENT_PREFLIGHT_JS,
    READ_XHS_ENVELOPE_JS,
    READ_XHS_ERROR_JS,
    resolveNoteTarget,
} from './comment-helpers.js';
import { isXiaohongshuHost, PINIA_ACCESS_JS } from './pinia-helpers.js';
import { readXhsDetailPage } from './risk-control.js';
import { unwrapEvaluateResult } from './shared.js';

const COMMAND_LABEL = 'xiaohongshu/comment';
const COMMENT_POST_PATH = '/api/sns/web/v1/comment/post';
export const UNVERIFIED_MARKER = 'COMMENT_UNVERIFIED';

/** Target resolution is shared with `comment-delete`; see comment-helpers.js. */
export function resolveCommentTarget(raw) {
    return resolveNoteTarget(raw, COMMAND_LABEL);
}

/**
 * Browser-side: post the comment. Returns `{ ok, comment_id, reason?, code?,
 * message? }`. Exactly one request — no retry lives in here or above it.
 */
export function buildCommentScript({ noteId, content }) {
    return `
(async () => {
  ${PINIA_ACCESS_JS}
  ${buildSignedApiFinderJs(COMMENT_POST_PATH)}
  ${READ_XHS_ENVELOPE_JS}
  ${READ_XHS_ERROR_JS}
  if (__xhsLoggedOut()) return { ok: false, reason: 'login_wall' };
  const postComment = __xhsFindSignedApi();
  if (!postComment) return { ok: false, reason: 'api_unavailable' };
  try {
    const env = __xhsEnvelope(__xhsClone(await postComment({
      note_id: ${JSON.stringify(noteId)},
      content: ${JSON.stringify(content)},
      at_users: [],
    })));
    if (env.rejected) {
      return { ok: false, reason: 'api_error', code: env.code, message: env.msg || 'comment rejected' };
    }
    const comment = (env.payload.comment && typeof env.payload.comment === 'object' ? env.payload.comment : null)
      || (env.inner.comment && typeof env.inner.comment === 'object' ? env.inner.comment : null)
      || {};
    const id = typeof comment.id === 'string' && comment.id ? comment.id : null;
    return { ok: true, comment_id: id };
  } catch (err) {
    return __xhsError(err);
  }
})()
`;
}

function requireActionResult(payload, context) {
    const inner = unwrapEvaluateResult(payload);
    if (!inner || typeof inner !== 'object' || Array.isArray(inner) || typeof inner.ok !== 'boolean') {
        throw new CommandExecutionError(`${COMMAND_LABEL}: malformed ${context} payload`);
    }
    return inner;
}

cli({
    site: 'xiaohongshu',
    name: 'comment',
    access: 'write',
    description: '在小红书笔记下发表评论（走页面自带的已签名请求层，需 --execute 才会真的发出）',
    domain: 'www.xiaohongshu.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    browser: true,
    args: [
        { name: 'note', required: true, positional: true, help: 'Full note URL with xsec_token (preferred), or a 24-char hex note ID' },
        { name: 'text', required: true, positional: true, help: 'Comment text to post' },
        { name: 'execute', type: 'boolean', help: 'Actually post the comment. Without it the command refuses to write.' },
    ],
    columns: ['status', 'comment_id', 'url', 'message', 'verified'],
    func: async (page, kwargs) => {
        if (!page) {
            throw new CommandExecutionError('Browser session required for xiaohongshu comment');
        }
        const content = String(kwargs.text ?? '').trim();
        if (!content) {
            throw new ArgumentError(`${COMMAND_LABEL}: comment text cannot be empty`);
        }
        const { noteId, noteUrl } = resolveCommentTarget(kwargs.note);
        // Write guard: posting is public and irreversible-ish, so require an
        // explicit opt-in — before anything touches the network.
        if (!kwargs.execute) {
            throw new ArgumentError('Refusing to post: pass --execute to actually publish this comment');
        }

        if (typeof page.evaluateOnce !== 'function') {
            throw new CommandExecutionError(`${COMMAND_LABEL} requires a runtime with evaluateOnce support`, 'Update opencli before posting; do not fall back to a retrying evaluator.');
        }

        try {
            // Paces the navigation and retries once through a cooldown when
            // risk control soft-blocks the page (throws SECURITY_BLOCK when it
            // is still blocked after that single retry).
            const preflight = unwrapEvaluateResult(await readXhsDetailPage(page, {
                url: noteUrl,
                extractJs: COMMENT_PREFLIGHT_JS,
                securityHelp: 'The note page is temporarily restricted. Wait a few minutes and try again — do not re-run in a loop.',
            }));
            if (!preflight || typeof preflight !== 'object') {
                throw new CommandExecutionError(`${COMMAND_LABEL}: malformed preflight payload`);
            }
            if (preflight.loginWall) {
                throw new AuthRequiredError('www.xiaohongshu.com', 'Posting a comment requires login');
            }
            if (preflight.notFound) {
                throw new EmptyResultError(COMMAND_LABEL, `Note ${noteId} not found or unavailable — it may have been deleted or restricted`);
            }
            // Never run the write against a page that is not the note we were
            // asked for — a redirect must not silently retarget the comment.
            const pageUrl = typeof preflight.pageUrl === 'string' ? preflight.pageUrl : '';
            let parsed;
            try {
                parsed = new URL(pageUrl);
            }
            catch {
                throw new CommandExecutionError(`${COMMAND_LABEL}: malformed preflight payload`);
            }
            if (parsed.protocol !== 'https:' || !isXiaohongshuHost(parsed.hostname)) {
                throw new CommandExecutionError(`${COMMAND_LABEL}: expected a Xiaohongshu note page, got ${parsed.hostname}`);
            }
            if (/\/login(?:[/?#]|$)/i.test(parsed.pathname)) {
                throw new AuthRequiredError('www.xiaohongshu.com');
            }
            if (parseNoteId(pageUrl) !== noteId) {
                throw new CommandExecutionError(`${COMMAND_LABEL}: expected note ${noteId}, got ${parsed.pathname}`);
            }

            const result = requireActionResult(await page.evaluateOnce(buildCommentScript({ noteId, content })), 'comment-action');
            if (!result.ok) {
                if (result.reason === 'login_wall') {
                    throw new AuthRequiredError('www.xiaohongshu.com');
                }
                if (result.reason === 'api_unavailable') {
                    throw new CommandExecutionError(
                        `${COMMAND_LABEL}: the page's comment API is unreachable; the site bundle may have changed.`,
                        'Update opencli or report this with `opencli xiaohongshu comment <url> <text> --execute --verbose`.',
                    );
                }
                const detail = result.reason === 'api_error'
                    ? `${result.message ?? 'unknown API error'}${result.code !== null && result.code !== undefined ? ` (code ${result.code})` : ''}`
                    : `${result.reason ?? 'unknown reason'}`;
                throw new CommandExecutionError(`${COMMAND_LABEL} failed: ${detail}`);
            }

            const commentId = typeof result.comment_id === 'string' && result.comment_id ? result.comment_id : null;
            if (!commentId) {
                // xhs accepted the write; only the id is missing. Never
                // downgrade that to a failure — a retry of a non-idempotent
                // write is worse than an unverified success.
                process.stderr.write(`${UNVERIFIED_MARKER}\n`);
                process.stderr.write(`${COMMAND_LABEL}: the comment was accepted but no comment id came back; check ${noteUrl} before posting again.\n`);
                return [{ status: 'posted-unverified', comment_id: null, url: noteUrl, message: content, verified: false }];
            }
            return [{
                status: 'success',
                comment_id: commentId,
                url: `${noteUrl}#comment-${commentId}`,
                message: content,
                verified: true,
            }];
        }
        catch (err) {
            if (err instanceof CliError) throw err;
            throw new CommandExecutionError(`${COMMAND_LABEL} failed: ${err?.message ?? String(err)}`);
        }
    },
});

export const __test__ = {
    buildCommentScript,
    resolveCommentTarget,
    COMMENT_PREFLIGHT_JS,
};
