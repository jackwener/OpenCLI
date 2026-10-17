/**
 * YouTube comment — post a top-level comment on a video via the InnerTube
 * `comment/create_comment` API (requires SAPISIDHASH auth, same recipe as like.js).
 *
 * Flow (one page.evaluate, three authenticated InnerTube calls):
 *   1. POST /youtubei/v1/next { videoId }        → comments-section continuation token
 *   2. POST /youtubei/v1/next { continuation }   → `createCommentParams` (found by leaf key
 *      because YouTube renames the wrapping renderers often; verified 2026-09-13 on a
 *      logged-in page at onResponseReceivedEndpoints[0].reloadContinuationItemsCommand
 *      .continuationItems[0].commentsHeaderRenderer.createRenderer.commentSimpleboxRenderer
 *      .submitButton.buttonRenderer.serviceEndpoint.createCommentEndpoint.createCommentParams)
 *   3. POST /youtubei/v1/comment/create_comment { createCommentParams, commentText }
 *
 *   4. POST /youtubei/v1/next (again) → read the comment list back and look for the id
 *
 * Step 4 exists because **a 2xx from create_comment does not mean the comment is
 * live**. Observed 2026-09-13 on video `_azfxIliMgI`: the API answered 200 with a
 * usable comment id (`UgxDsuScjOf_N_l8Cu94AaABAg`), this command reported success
 * with an `&lc=` permalink, and the comment was nowhere — the video read "0
 * comments", `youtube comments` returned `[]`, and it never showed up in the
 * account's Google activity log. YouTube had silently withheld it.
 *
 * So the id the write returns is treated as *informational only*. What decides
 * `verified` is whether that id actually appears in the video's comment list.
 * Re-reading is safe (reads are idempotent); the WRITE above still happens exactly
 * once and is never retried.
 *
 * A comment that is live but missing from the list we read would be reported as
 * unverified. That asymmetry is deliberate: an unverified success costs the caller
 * one look at the video, while a false success makes them believe a comment landed
 * when it did not.
 *
 * Posting is public and non-idempotent, so:
 *   - `--execute` is required; without it the command refuses before any navigation.
 *   - the command never retries the write. When YouTube accepts it but the comment
 *     cannot be seen in the list (or no id came back at all), the row is still
 *     reported as posted with `verified: false` and a `COMMENT_UNVERIFIED` line on
 *     stderr — callers must treat that as "sent, go check", never as a failure to
 *     retry.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    findKeyDeep,
    isYoutubeVideoId,
    parseVideoId,
    prepareYoutubeApiPage,
    readYoutubeSapisid,
    SAPISID_HASH_FN,
} from './utils.js';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

export const UNVERIFIED_MARKER = 'COMMENT_UNVERIFIED';

function unwrapBrowserResult(value) {
    if (value && typeof value === 'object' && !Array.isArray(value) && 'session' in value && 'data' in value) {
        return value.data;
    }
    return value;
}

export function buildCommentScript({ sapisid, videoId, text }) {
    return `
      (async () => {
        ${SAPISID_HASH_FN}
        ${findKeyDeep.toString()}

        const cfg = window.ytcfg?.data_ || {};
        const apiKey = cfg.INNERTUBE_API_KEY;
        const context = cfg.INNERTUBE_CONTEXT;
        if (!apiKey || !context) return { error: 'config', message: 'YouTube config not found' };

        const authHash = await getSapisidHash(${JSON.stringify(sapisid)}, 'https://www.youtube.com');
        if (!authHash) return { error: 'auth', message: 'Not logged in (SAPISID cookie missing)' };

        // One helper for all three calls; returns { error } on failure, { body } on success.
        async function post(path, payload) {
          const resp = await fetch('/youtubei/v1/' + path + '?key=' + apiKey + '&prettyPrint=false', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': authHash,
              'X-Origin': 'https://www.youtube.com',
            },
            body: JSON.stringify({ context, ...payload }),
          });
          if (resp.status === 401 || resp.status === 403) return { error: 'auth', message: 'Not logged in' };
          const body = await resp.json().catch(() => ({}));
          if (!resp.ok) {
            const errStatus = body?.error?.status || '';
            if (errStatus === 'UNAUTHENTICATED') return { error: 'auth', message: 'Not logged in' };
            const errMessage = body?.error?.message ? ' ' + body.error.message : '';
            return { error: 'http', message: path + ': HTTP ' + resp.status + (errStatus ? ' ' + errStatus : '') + errMessage };
          }
          return { body };
        }

        const videoId = ${JSON.stringify(videoId)};

        // Fresh comments-section continuation token. Tokens are snapshots, so the
        // read-back has to take a new one each round rather than reuse step 1's.
        async function commentsContinuation() {
          const next = await post('next', { videoId });
          if (next.error) return next;
          const results = next.body?.contents?.twoColumnWatchNextResults?.results?.results?.contents || [];
          const section = results.find(i => i.itemSectionRenderer?.targetId === 'comments-section');
          const token = section?.itemSectionRenderer?.contents?.[0]?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
          if (!token) return { error: 'http', message: 'No comment section found — comments may be disabled' };
          return { token };
        }

        // Step 1 + 2: createCommentParams from the comments header
        // (createRenderer / commentSimpleboxRenderer).
        const first = await commentsContinuation();
        if (first.error) return first;
        const section = await post('next', { continuation: first.token });
        if (section.error) return section;
        const createCommentParams = findKeyDeep(section.body, 'createCommentParams');
        if (typeof createCommentParams !== 'string' || !createCommentParams) {
          return { error: 'http', message: 'createCommentParams not found — comments may be disabled or the page layout changed' };
        }

        // Step 3: the write. Exactly one call, never retried.
        const created = await post('comment/create_comment', {
          createCommentParams,
          commentText: ${JSON.stringify(text)},
        });
        if (created.error) return created;

        // The id is informational, NOT proof of publication — YouTube hands one back
        // even for comments it silently withholds. Prefer the id echoed inside
        // createCommentAction's own thread over a stray one elsewhere in the body
        // (a notice/dialog renderer can carry a commentId too), then let step 4 rule.
        const actions = created.body?.actions || [];
        const thread = actions.map(a => a?.createCommentAction?.contents?.commentThreadRenderer).find(Boolean);
        const scoped = thread ? findKeyDeep(thread, 'commentId') : undefined;
        const anywhere = findKeyDeep(created.body, 'commentId');
        const commentId = [scoped, anywhere].find(v => typeof v === 'string' && v) || null;

        // Step 4: the read-back. Collect the comment ids the video actually lists.
        async function listedComments() {
          const cont = await commentsContinuation();
          if (cont.error) return null;
          const page = await post('next', { continuation: cont.token });
          if (page.error) return null;
          let body = page.body;
          // Sort by "Newest first" when offered: a brand-new comment is not
          // necessarily on page 1 of the default "Top comments" ordering, and
          // missing it there would report a live comment as unverified.
          const menu = findKeyDeep(body, 'sortFilterSubMenuRenderer');
          const items = Array.isArray(menu?.subMenuItems) ? menu.subMenuItems : [];
          const newest = items.find(i => /newest|最新|最新順/i.test(String(i?.title || ''))) || items[items.length - 1];
          const newestToken = newest?.serviceEndpoint?.continuationCommand?.token;
          if (newestToken) {
            const sorted = await post('next', { continuation: newestToken });
            if (!sorted.error) body = sorted.body;
          }
          const mutations = body?.frameworkUpdates?.entityBatchUpdate?.mutations || [];
          const ids = mutations
            .map(m => m?.payload?.commentEntityPayload?.properties?.commentId)
            .filter(v => typeof v === 'string' && v);
          // Empty is a real answer ("this video lists no comments"), so only fall
          // back to a raw scan when the payload shape itself is unrecognisable.
          if (ids.length || mutations.length) return { ids };
          return { raw: JSON.stringify(body || {}) };
        }

        // visible = the id was found in the list; listRead = the list could be read
        // at all. The command turns those two into the verified column.
        let visible = false;
        let listRead = false;
        if (commentId) {
          for (let attempt = 0; attempt < 3 && !visible; attempt += 1) {
            if (attempt > 0) await new Promise(r => setTimeout(r, 2000));
            // A read-back failure cannot undo an already accepted write.
            let listed;
            try { listed = await listedComments(); } catch { continue; }
            if (!listed) continue;
            listRead = true;
            visible = listed.ids ? listed.ids.includes(commentId) : listed.raw.includes(commentId);
          }
        }
        return { ok: true, commentId, visible, listRead };
      })()
    `;
}

cli({
    site: 'youtube',
    name: 'comment',
    access: 'write',
    description: 'Post a top-level comment on a YouTube video (requires --execute)',
    domain: 'www.youtube.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    args: [
        { name: 'url', required: true, positional: true, help: 'YouTube video URL or video ID' },
        { name: 'text', required: true, positional: true, help: 'Comment text to post' },
        { name: 'execute', type: 'boolean', help: 'Actually post the comment. Without it the command refuses to write.' },
    ],
    columns: ['status', 'comment_id', 'url', 'message', 'verified'],
    func: async (page, kwargs) => {
        const text = String(kwargs.text ?? '').trim();
        if (!text) throw new ArgumentError('youtube comment text cannot be empty');
        const videoId = parseVideoId(String(kwargs.url ?? ''));
        if (!isYoutubeVideoId(videoId)) {
            throw new ArgumentError(`youtube comment target is not a video URL or 11-char video id: ${kwargs.url}`);
        }
        // Write guard: posting is public and irreversible-ish, so require an explicit opt-in.
        if (!kwargs.execute) {
            throw new ArgumentError('Refusing to post: pass --execute to actually publish this comment');
        }

        if (typeof page.evaluateOnce !== 'function') {
            throw new CommandExecutionError('youtube comment requires a runtime with evaluateOnce support', 'Update opencli before posting; do not fall back to a retrying evaluator.');
        }
        await prepareYoutubeApiPage(page);
        const sapisid = await readYoutubeSapisid(page);
        if (!sapisid) {
            throw new AuthRequiredError('www.youtube.com', 'Not logged in (SAPISID cookie missing)');
        }

        const result = unwrapBrowserResult(await page.evaluateOnce(buildCommentScript({ sapisid, videoId, text })));
        if (result?.error === 'auth') {
            throw new AuthRequiredError('www.youtube.com');
        }
        if (result?.error) {
            throw new CommandExecutionError(result.message || 'Failed to post comment');
        }
        if (!result || result.ok !== true) {
            throw new CommandExecutionError('youtube comment: malformed result from the page script');
        }

        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const commentId = typeof result.commentId === 'string' && result.commentId ? result.commentId : null;
        if (result.visible !== true) {
            // YouTube accepted the write, but the comment is not visible in the
            // video's own comment list — so it may have been silently withheld.
            // Never downgrade that to a failure: a retry of a non-idempotent write
            // is worse than an unverified success. Callers key off the marker line.
            const why = !commentId
                ? 'returned no comment id'
                : result.listRead === true
                    ? `returned comment id ${commentId}, but it is not in the video's comment list — YouTube may have withheld it`
                    : `returned comment id ${commentId}, but the comment list could not be read back`;
            process.stderr.write(`${UNVERIFIED_MARKER}\n`);
            process.stderr.write(`YouTube accepted the comment and ${why}; check ${videoUrl} before posting again.\n`);
            // No `&lc=` permalink here — it would point at a comment nobody can see.
            return [{ status: 'posted-unverified', comment_id: commentId, url: videoUrl, message: text, verified: false }];
        }
        return [{
            status: 'success',
            comment_id: commentId,
            url: `${videoUrl}&lc=${commentId}`,
            message: text,
            verified: true,
        }];
    },
});
