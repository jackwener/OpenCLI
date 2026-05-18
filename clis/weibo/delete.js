/**
 * Weibo delete — remove a single post owned by the logged-in user.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { requireObjectEvaluateResult, unwrapEvaluateResult } from './utils.js';

const WEIBO_HOST_RE = /(^|\.)weibo\.(com|cn)$/i;
const POST_ID_RE = /^[A-Za-z0-9]{4,32}$/;

function normalizePostId(raw) {
    const input = String(raw ?? '').trim();
    if (!input) {
        throw new ArgumentError('weibo delete: id cannot be empty');
    }

    let candidate = input;
    try {
        const url = new URL(input);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            throw new ArgumentError('weibo delete: URL must use http or https');
        }
        if (!WEIBO_HOST_RE.test(url.hostname)) {
            throw new ArgumentError('weibo delete: URL must be a weibo.com or weibo.cn post URL');
        }
        const parts = url.pathname.split('/').filter(Boolean);
        if (url.hostname.toLowerCase().endsWith('weibo.cn') && parts[0] === 'status') {
            candidate = parts[1] ?? '';
        } else {
            candidate = parts.at(-1) ?? '';
        }
    } catch (error) {
        if (error instanceof ArgumentError) throw error;
    }

    candidate = String(candidate ?? '').trim();
    if (!POST_ID_RE.test(candidate)) {
        throw new ArgumentError('weibo delete: id must be a numeric idstr, mblogid, or Weibo post URL');
    }
    return candidate;
}

cli({
    site: 'weibo',
    name: 'delete',
    access: 'write',
    description: 'Delete one of my Weibo posts by id',
    domain: 'weibo.com',
    strategy: Strategy.COOKIE,
    args: [
        {
            name: 'id',
            required: true,
            positional: true,
            help: 'Post ID (numeric idstr or mblogid from URL / weibo me / weibo post output)',
        },
    ],
    columns: ['status', 'id', 'mblogid'],
    func: async (page, kwargs) => {
        if (!page) {
            throw new CommandExecutionError('Browser session required for weibo delete');
        }
        const raw = String(kwargs.id ?? '').trim();
        const id = normalizePostId(raw);
        await page.goto('https://weibo.com');
        await page.wait(2);
        const result = requireObjectEvaluateResult(unwrapEvaluateResult(await page.evaluate(`
      (async () => {
        const input = ${JSON.stringify(id)};
        const readCookie = (name) => {
          const pair = document.cookie.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
          return pair ? decodeURIComponent(pair.slice(name.length + 1)) : '';
        };
        // Step 1: resolve mblogid / idstr to canonical idstr via /show.
        const showResp = await fetch('/ajax/statuses/show?id=' + encodeURIComponent(input), { credentials: 'include' });
        if (showResp.status === 401 || showResp.status === 403) {
          return { ok: false, error: 'auth', status: showResp.status };
        }
        // 404 from /show means the post does not exist (deleted, wrong id, or
        // not owned by the logged-in user); map to the same path as a 2xx
        // response with no idstr so the caller throws EmptyResultError
        // instead of a generic CommandExecutionError("HTTP 404").
        if (showResp.status === 404) {
          return { ok: false, error: 'not_found', input };
        }
        if (!showResp.ok) {
          return { ok: false, error: 'show_http', status: showResp.status };
        }
        const showBody = await showResp.json();
        if (!showBody || !showBody.idstr) {
          return { ok: false, error: 'not_found', input };
        }
        const idstr = String(showBody.idstr);
        const mblogid = showBody.mblogid || '';
        // Step 2: destroy. Weibo requires X-Xsrf-Token (double-submit CSRF token).
        const token = readCookie('XSRF-TOKEN');
        const destroyResp = await fetch('/ajax/statuses/destroy', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Xsrf-Token': token,
          },
          body: 'id=' + encodeURIComponent(idstr),
        });
        if (destroyResp.status === 401 || destroyResp.status === 403) {
          return { ok: false, error: 'auth', status: destroyResp.status };
        }
        if (!destroyResp.ok) {
          return { ok: false, error: 'destroy_http', status: destroyResp.status };
        }
        const destroyBody = await destroyResp.json();
        // Require an explicit success signal from the API: { ok: 1 }. A
        // missing / falsy body must not be silently treated as success.
        if (!destroyBody || typeof destroyBody !== 'object') {
          return { ok: false, error: 'api', msg: 'destroy returned malformed response', id: idstr };
        }
        if (destroyBody.ok !== 1) {
          return { ok: false, error: 'api', msg: destroyBody.msg || destroyBody.message || 'destroy returned non-ok', id: idstr };
        }
        // Step 3: postcondition evidence. A write command cannot report success
        // until the target no longer resolves after the delete API returns ok.
        const verifyResp = await fetch('/ajax/statuses/show?id=' + encodeURIComponent(idstr), { credentials: 'include' });
        if (verifyResp.status === 401 || verifyResp.status === 403) {
          return { ok: false, error: 'auth', status: verifyResp.status };
        }
        if (verifyResp.status === 404) {
          return { ok: true, id: idstr, mblogid };
        }
        if (!verifyResp.ok) {
          return { ok: false, error: 'verify_http', status: verifyResp.status, id: idstr };
        }
        let verifyBody = null;
        try {
          verifyBody = await verifyResp.json();
        } catch {
          return { ok: false, error: 'verify_malformed', msg: 'verify returned non-JSON response', id: idstr };
        }
        if (!verifyBody || typeof verifyBody !== 'object') {
          return { ok: false, error: 'verify_malformed', msg: 'verify returned malformed response', id: idstr };
        }
        if (String(verifyBody.idstr || '') === idstr) {
          return { ok: false, error: 'still_exists', id: idstr, mblogid: verifyBody.mblogid || mblogid };
        }
        if (!verifyBody.idstr || verifyBody.ok === 0) {
          return { ok: true, id: idstr, mblogid };
        }
        return { ok: false, error: 'verify_mismatch', msg: 'verify returned a different post id', id: idstr };
      })()
    `)), 'weibo delete');
        if (result.error === 'auth') {
            throw new AuthRequiredError('weibo.com', 'Cookie 已过期！请在当前 Chrome 浏览器中重新登录 Weibo。');
        }
        if (result.error === 'not_found') {
            throw new EmptyResultError('weibo delete', `Post not found for id "${String(result.input ?? raw)}". Verify the post still exists and belongs to the logged-in account.`);
        }
        if (result.error === 'show_http' || result.error === 'destroy_http' || result.error === 'verify_http') {
            throw new CommandExecutionError(`weibo delete: HTTP ${result.status}`);
        }
        if (result.error === 'api' || result.error === 'verify_malformed' || result.error === 'verify_mismatch' || result.error === 'still_exists') {
            throw new CommandExecutionError(`weibo delete: ${String(result.msg ?? result.error)}`);
        }
        if (!result.ok) {
            throw new CommandExecutionError('weibo delete returned an unexpected response');
        }
        return [{ status: 'deleted', id: String(result.id ?? ''), mblogid: String(result.mblogid ?? '') }];
    },
});

export const __test__ = {
    normalizePostId,
};
