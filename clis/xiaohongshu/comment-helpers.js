/**
 * Shared pieces for the Xiaohongshu comment write commands (`comment`,
 * `comment-delete`).
 *
 * Both of them have the same problem to solve: xhs web APIs need `x-s` / `x-t` /
 * `x-s-common` headers that only the app's own axios instance produces (see
 * pinia-helpers.js), and — unlike `follow` — there is no Pinia action to borrow.
 * Probing a logged-in note page (2026-09-13) showed the `note` store carries only
 * comment *view* state and the sole comment-writing action anywhere,
 * `notification.replyComment`, belongs to the notifications page. The comment box
 * calls a bundled API module directly, so both commands reach that module through
 * webpack's runtime and call the wrapper the UI itself uses:
 *
 *   postApiSnsWebV1CommentPost(body, opts)    → POST /api/sns/web/v1/comment/post
 *   postApiSnsWebV1CommentDelete(body, opts)  → POST /api/sns/web/v1/comment/delete
 *
 * Both live in the same module and are found the same way, which is why the
 * lookup is factored out here rather than copied.
 */
import { ArgumentError } from '@jackwener/opencli/errors';
import { buildNoteUrl, parseNoteId, XHS_SIGNED_URL_HINT } from './note-helpers.js';

/** Note and comment ids are both 24 hex chars (e.g. 6aa65245000000002603bb74). */
export const XHS_HEX_ID_RE = /^[a-f0-9]{24}$/i;

/**
 * Resolve a note target into `{ noteId, noteUrl }`.
 *
 * A full signed URL is the reliable input — bare ids frequently fail to open
 * because the note page wants an `xsec_token` — but a bare id is still accepted,
 * since a caller that only kept the id has nothing better to pass.
 */
export function resolveNoteTarget(raw, commandLabel) {
    const input = String(raw ?? '').trim();
    if (!input) {
        throw new ArgumentError(`${commandLabel}: note target cannot be empty`, XHS_SIGNED_URL_HINT);
    }
    if (/^https?:\/\//i.test(input)) {
        // Rejects anything that is not an https xiaohongshu note URL carrying an
        // xsec_token, with the shared "needs a signed URL" hint.
        const noteUrl = buildNoteUrl(input, { commandName: commandLabel.replace('/', ' ') });
        const noteId = parseNoteId(input);
        if (!XHS_HEX_ID_RE.test(noteId)) {
            throw new ArgumentError(`${commandLabel}: cannot read a note id out of ${input}`, XHS_SIGNED_URL_HINT);
        }
        return { noteId, noteUrl };
    }
    if (!XHS_HEX_ID_RE.test(input)) {
        throw new ArgumentError(`${commandLabel}: note target must be a full note URL with xsec_token, or a 24-character hex note id`, XHS_SIGNED_URL_HINT);
    }
    return { noteId: input, noteUrl: `https://www.xiaohongshu.com/explore/${input}` };
}

/** Browser-side: is the note page usable, or blocked / walled / gone? */
export const COMMENT_PREFLIGHT_JS = `
      (() => {
        const bodyText = document.body?.innerText || ''
        const loginWall = /登录后查看|请登录/.test(bodyText)
        const notFound = /页面不见了|笔记不存在|无法浏览/.test(bodyText)
        const securityBlock = /安全限制|访问链接异常/.test(bodyText)
          || /website-login\\/error|error_code=300017|error_code=300031/.test(location.href)
        return { pageUrl: location.href, securityBlock, loginWall, notFound }
      })()
`;

/**
 * Browser-side prelude defining `__xhsFindSignedApi()`, which digs the signed
 * wrapper for `endpoint` out of the webpack module graph.
 *
 * The wrapper is located by matching the endpoint string in the function's own
 * source, NOT by its minified export name — that name changes on every xhs build
 * (it was `pe` for comment/post on 2026-09-13).
 */
export function buildSignedApiFinderJs(endpoint) {
    return `
  const __xhsFindSignedApi = () => {
    const chunk = window.webpackChunkxhs_pc_web;
    if (!Array.isArray(chunk)) return null;
    // Pushing a chunk whose module map is empty hands our callback the runtime's
    // own __webpack_require__ and loads nothing.
    let req = null;
    try { chunk.push([['__opencli_xhs__'], {}, (r) => { req = r; }]); } catch { return null; }
    if (typeof req !== 'function') return null;
    const NEEDLE = ${JSON.stringify(endpoint)};
    // The wrapper reads: fn(body, opts) { opts.summary = '…'; return axios.post(NEEDLE, body, opts) }
    const pick = (mod) => {
      if (!mod || (typeof mod !== 'object' && typeof mod !== 'function')) return null;
      let keys = [];
      try { keys = Object.keys(mod); } catch { return null; }
      for (const k of keys) {
        let fn = null;
        try { fn = mod[k]; } catch { continue; }
        if (typeof fn !== 'function') continue;
        let src = '';
        try { src = String(fn); } catch { continue; }
        if (src.indexOf(NEEDLE) !== -1 && src.indexOf('.post(') !== -1) return fn;
      }
      return null;
    };
    // Prefer modules webpack has already instantiated: evaluating one the page
    // never loaded can have side effects we have no business triggering.
    const cache = req.c || {};
    for (const id of Object.keys(cache)) {
      const hit = pick(cache[id] && cache[id].exports);
      if (hit) return hit;
    }
    const factories = req.m || {};
    for (const id of Object.keys(factories)) {
      let src = '';
      try { src = String(factories[id]); } catch { continue; }
      if (src.indexOf(NEEDLE) === -1) continue;
      let mod = null;
      try { mod = req(id); } catch { continue; }
      const hit = pick(mod);
      if (hit) return hit;
    }
    return null;
  };
`;
}

/**
 * Browser-side: read `{ code, success, msg }` out of an xhs API answer.
 *
 * Depending on the axios interceptor the body arrives unwrapped or still nested
 * under a `data` property, so both shapes are read (as follow.js does).
 */
export const READ_XHS_ENVELOPE_JS = `
  const __xhsEnvelope = (response) => {
    const payload = response && typeof response === 'object' ? response : {};
    const inner = payload.data && typeof payload.data === 'object' ? payload.data : {};
    const code = payload.code !== undefined ? payload.code : inner.code;
    const success = payload.success !== undefined ? payload.success : inner.success;
    const msg = payload.msg || payload.message || inner.msg || inner.message || '';
    // A 2xx carrying a non-zero code is a rejected write, not a completed one.
    const rejected = (code !== undefined && code !== null && code !== 0) || success === false;
    const confirmed = !rejected && (code === 0 || success === true);
    return { payload, inner, code: code === undefined ? null : code, rejected, confirmed, msg: String(msg || '') };
  };
`;

/** Browser-side: normalise a thrown axios error into `{ code, message }`. */
export const READ_XHS_ERROR_JS = `
  const __xhsError = (err) => {
    const data = err && err.data ? __xhsClone(err.data) : null;
    const code = (data && (data.code !== undefined ? data.code : data.result && data.result.code)) ?? (err && err.code);
    const message = (data && (data.msg || data.message)) || (err && (err.msg || err.message)) || String(err);
    return { ok: false, reason: 'api_error', code: code === undefined ? null : code, message: String(message) };
  };
`;
