/**
 * Xiaohongshu comment-delete — delete one of your own comments on a note,
 * through the page's own signed request layer.
 *
 * Companion to `comment`. Same route, same reasons: no Pinia action exists for
 * comments, so this reaches the note page's bundled API module through webpack's
 * runtime and calls `postApiSnsWebV1CommentDelete(body, opts)` — the wrapper the
 * UI itself uses for POST /api/sns/web/v1/comment/delete, which is what gets the
 * `x-s` / `x-t` / `x-s-common` headers signed for us. See comment-helpers.js.
 *
 * Why not the UI: on the web the "…" affordance only appears while the pointer is
 * over the comment, and the menu then opens on *click* — not on hover. Treating it
 * as a hover-expanded menu is the natural reading and it is wrong; it costs a long
 * time to work out, because the menu keeps "closing" that never opened. The mobile
 * app is no better: long-pressing your own comment opens the note share sheet
 * rather than a delete option. Going through the API sidesteps both.
 *
 * (A working UI path does exist, established 2026-09-13: real hover to reveal the
 * "…", left-click it, then click "删除评论" and confirm — for your own comment the
 * menu holds only 删除评论/取消, so there is no report button to mis-click. Worth
 * keeping as a fallback if the API route ever gets fenced off.)
 *
 * Deleting is the mirror image of posting where retries are concerned, and the
 * error handling is deliberately the opposite:
 *
 *   - `comment` is NOT idempotent, so an accepted-but-unconfirmed write is
 *     reported as success (`COMMENT_UNVERIFIED`) — a retry would double-post.
 *   - `comment-delete` IS effectively idempotent: deleting an already-deleted
 *     comment changes nothing. So this command can afford to be strict and fail
 *     loudly when xhs does not confirm, because the fix is simply to run it again.
 *
 * `--execute` is still required: deleting someone's comment is destructive and
 * xhs offers no undo.
 *
 * Requires: logged into www.xiaohongshu.com in Chrome, as the comment's author.
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
    XHS_HEX_ID_RE,
} from './comment-helpers.js';
import { isXiaohongshuHost, PINIA_ACCESS_JS } from './pinia-helpers.js';
import { readXhsDetailPage } from './risk-control.js';
import { unwrapEvaluateResult } from './shared.js';

const COMMAND_LABEL = 'xiaohongshu/comment-delete';
const COMMENT_DELETE_PATH = '/api/sns/web/v1/comment/delete';

export function assertCommentId(raw) {
    const input = String(raw ?? '').trim();
    if (!XHS_HEX_ID_RE.test(input)) {
        throw new ArgumentError(
            `${COMMAND_LABEL}: comment-id must be a 24-character hex comment id (e.g. 6aa6bdb0000000000b0074cb)`,
            'The `comment` command prints the id it created as `comment_id`; `comments` does not expose ids.',
        );
    }
    return input;
}

/**
 * Browser-side: delete the comment. Returns `{ ok, reason?, code?, message? }`.
 * Exactly one request.
 */
export function buildDeleteScript({ noteId, commentId }) {
    return `
(async () => {
  ${PINIA_ACCESS_JS}
  ${buildSignedApiFinderJs(COMMENT_DELETE_PATH)}
  ${READ_XHS_ENVELOPE_JS}
  ${READ_XHS_ERROR_JS}
  if (__xhsLoggedOut()) return { ok: false, reason: 'login_wall' };
  const deleteComment = __xhsFindSignedApi();
  if (!deleteComment) return { ok: false, reason: 'api_unavailable' };
  try {
    const env = __xhsEnvelope(__xhsClone(await deleteComment({
      note_id: ${JSON.stringify(noteId)},
      comment_id: ${JSON.stringify(commentId)},
    })));
    if (env.rejected) {
      return { ok: false, reason: 'api_error', code: env.code, message: env.msg || 'delete rejected' };
    }
    if (!env.confirmed) {
      return { ok: false, reason: 'unconfirmed', message: 'The API returned no recognizable deletion confirmation' };
    }
    return { ok: true };
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
    name: 'comment-delete',
    access: 'write',
    description: '删除自己在小红书笔记下的评论（走页面自带的已签名请求层，需 --execute 才会真的删除）',
    domain: 'www.xiaohongshu.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    browser: true,
    args: [
        { name: 'note', required: true, positional: true, help: 'Full note URL with xsec_token (preferred), or a 24-char hex note ID' },
        { name: 'comment-id', required: true, positional: true, help: 'The comment ID to delete (as printed by `xiaohongshu comment`)' },
        { name: 'execute', type: 'boolean', help: 'Actually delete the comment. Without it the command refuses to write.' },
    ],
    columns: ['status', 'comment_id', 'note_id', 'url'],
    func: async (page, kwargs) => {
        if (!page) {
            throw new CommandExecutionError('Browser session required for xiaohongshu comment-delete');
        }
        const commentId = assertCommentId(kwargs['comment-id']);
        const { noteId, noteUrl } = resolveNoteTarget(kwargs.note, COMMAND_LABEL);
        // Write guard: deleting is destructive and xhs has no undo, so require an
        // explicit opt-in — before anything touches the network.
        if (!kwargs.execute) {
            throw new ArgumentError('Refusing to delete: pass --execute to actually delete this comment');
        }

        try {
            // Paces the navigation and retries once through a cooldown when risk
            // control soft-blocks the page (throws SECURITY_BLOCK when it is still
            // blocked after that single retry).
            const preflight = unwrapEvaluateResult(await readXhsDetailPage(page, {
                url: noteUrl,
                extractJs: COMMENT_PREFLIGHT_JS,
                securityHelp: 'The note page is temporarily restricted. Wait a few minutes and try again — do not re-run in a loop.',
            }));
            if (!preflight || typeof preflight !== 'object') {
                throw new CommandExecutionError(`${COMMAND_LABEL}: malformed preflight payload`);
            }
            if (preflight.loginWall) {
                throw new AuthRequiredError('www.xiaohongshu.com', 'Deleting a comment requires login');
            }
            if (preflight.notFound) {
                throw new EmptyResultError(COMMAND_LABEL, `Note ${noteId} not found or unavailable — it may have been deleted or restricted`);
            }
            // Never run the delete against a page that is not the note we were asked
            // for — a redirect must not silently retarget a destructive write.
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

            const result = requireActionResult(await page.evaluate(buildDeleteScript({ noteId, commentId })), 'delete-action');
            if (!result.ok) {
                if (result.reason === 'login_wall') {
                    throw new AuthRequiredError('www.xiaohongshu.com');
                }
                if (result.reason === 'api_unavailable') {
                    throw new CommandExecutionError(
                        `${COMMAND_LABEL}: the page's comment API is unreachable; the site bundle may have changed.`,
                        'Update opencli or report this with `opencli xiaohongshu comment-delete <url> <id> --execute --verbose`.',
                    );
                }
                // Unlike `comment`, an unconfirmed delete is reported as a failure:
                // re-running a delete is harmless, so a false failure costs one retry
                // while a false success would leave the comment up.
                const detail = result.reason === 'api_error'
                    ? `${result.message ?? 'unknown API error'}${result.code !== null && result.code !== undefined ? ` (code ${result.code})` : ''}`
                    : `${result.reason ?? 'unknown reason'}`;
                throw new CommandExecutionError(`${COMMAND_LABEL} failed: ${detail}`);
            }

            return [{
                status: 'deleted',
                comment_id: commentId,
                note_id: noteId,
                url: noteUrl,
            }];
        }
        catch (err) {
            if (err instanceof CliError) throw err;
            throw new CommandExecutionError(`${COMMAND_LABEL} failed: ${err?.message ?? String(err)}`);
        }
    },
});

export const __test__ = {
    assertCommentId,
    buildDeleteScript,
};
