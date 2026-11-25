import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { unwrapEvaluateResult } from './evaluate-result.js';

function isAuthLikeError(code, message) {
    const text = String(message ?? '');
    return code === 401 || code === 403 || /login|cookie|auth|captcha|verify|forbidden|permission|登录|登陆|权限|验证|验证码/i.test(text);
}

const STALLED = '__opencli_request_stalled__';

/**
 * Execute a fetch() call inside the Chrome browser context via page.evaluate.
 * This ensures a_bogus signing and cookies are handled automatically by the browser.
 *
 * When Douyin shows a verification (captcha) prompt, its page JS holds signed
 * requests open until the prompt is solved and ignores the abort signal, so the
 * fetch is also raced against a timer: a request that never settles fails typed
 * instead of hanging the command.
 */
export async function browserFetch(page, method, url, options = {}) {
    const timeoutMs = Number(options.timeoutMs ?? 30000);
    const js = `
    Promise.race([(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ${timeoutMs});
      try {
        const res = await fetch(${JSON.stringify(url)}, {
          method: ${JSON.stringify(method)},
          credentials: 'include',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            ...${JSON.stringify(options.headers ?? {})}
          },
          ${options.body ? `body: JSON.stringify(${JSON.stringify(options.body)}),` : ''}
        });
        const text = await res.text();
        // A retired or gated endpoint answers 200 with no body. Reporting that
        // as a parse failure sends readers after the JSON instead of the
        // endpoint (issue #1405 fixed it, #1587 dropped it again).
        if (!text.trim()) return res.ok ? null : { status_code: res.status, status_msg: 'Empty response body' };
        try {
          const data = JSON.parse(text);
          if (!res.ok) return { status_code: res.status, status_msg: data?.status_msg || data?.message || 'HTTP request failed' };
          return data;
        } catch (error) {
          return { status_code: res.ok ? -2 : res.status, status_msg: \`JSON parse failed: \${text.slice(0, 500) || String(error && error.message || error)}\` };
        }
      } catch (error) {
        return { status_code: -1, status_msg: String(error && error.message || error) };
      } finally {
        clearTimeout(timer);
      }
    })(), new Promise((resolve) => setTimeout(() => resolve({ status_code: -3, status_msg: ${JSON.stringify(STALLED)} }), ${Math.round(timeoutMs * 1.1) + 50}))])
  `;
    let result;
    for (let attempt = 1; ; attempt++) {
        try {
            result = unwrapEvaluateResult(await page.evaluate(js));
            break;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // The tab occasionally detaches mid-command (~4 in 1,100 live runs); a
            // second try on the same page succeeded every time.
            if (attempt === 1 && /detached/i.test(message)) {
                await page.wait?.({ time: 1 });
                continue;
            }
            throw new CommandExecutionError(`Douyin API request failed (${method} ${url}): ${message}`);
        }
    }
    if (result == null) {
        throw new CommandExecutionError(
            `Empty response from Douyin API (${method} ${url})`,
            'The endpoint may have been retired or may now require signed parameters.',
        );
    }
    if (Array.isArray(result) || typeof result !== 'object') {
        throw new CommandExecutionError(`Malformed response from Douyin API (${method} ${url})`);
    }
    if (result.status_code === -3 && result.status_msg === STALLED) {
        throw new AuthRequiredError(
            new URL(url).hostname,
            `Douyin request did not settle within ${Math.round(timeoutMs / 1000)}s (${method} ${url})`,
            'Douyin is likely showing a verification (captcha) prompt in the browser tab. Solve it in Chrome, wait a while, then retry; slow down if it keeps coming back.',
        );
    }
    if (result && typeof result === 'object' && 'status_code' in result) {
        const code = result.status_code;
        if (code !== 0) {
            const msg = result.status_msg ?? result.message ?? 'unknown error';
            if (isAuthLikeError(code, msg)) {
                throw new AuthRequiredError('creator.douyin.com', `Douyin API auth/permission error ${code} at ${method} ${url}: ${msg}`);
            }
            throw new CommandExecutionError(`Douyin API error ${code} at ${method} ${url}: ${msg}`);
        }
    }
    return result;
}
