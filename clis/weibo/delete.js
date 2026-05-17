/**
 * Weibo delete — remove a single post owned by the logged-in user.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { requireObjectEvaluateResult, unwrapEvaluateResult } from './utils.js';
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
        const raw = String(kwargs.id ?? '').trim();
        if (!raw) {
            throw new ArgumentError('weibo delete: id cannot be empty');
        }
        await page.goto('https://weibo.com');
        await page.wait(2);
        const result = requireObjectEvaluateResult(unwrapEvaluateResult(await page.evaluate(`
      (async () => {
        const input = ${JSON.stringify(raw)};
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
        return { ok: true, id: idstr, mblogid };
      })()
    `)), 'weibo delete');
        if (result.error === 'auth') {
            throw new AuthRequiredError('weibo.com', 'Cookie 已过期！请在当前 Chrome 浏览器中重新登录 Weibo。');
        }
        if (result.error === 'not_found') {
            throw new EmptyResultError('weibo delete', `Post not found for id "${String(result.input ?? raw)}". Verify the post still exists and belongs to the logged-in account.`);
        }
        if (result.error === 'show_http' || result.error === 'destroy_http') {
            throw new CommandExecutionError(`weibo delete: HTTP ${result.status}`);
        }
        if (result.error === 'api') {
            throw new CommandExecutionError(`weibo delete: ${String(result.msg)}`);
        }
        if (!result.ok) {
            throw new CommandExecutionError('weibo delete returned an unexpected response');
        }
        return [{ status: 'deleted', id: String(result.id ?? ''), mblogid: String(result.mblogid ?? '') }];
    },
});
