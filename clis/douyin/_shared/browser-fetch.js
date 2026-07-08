import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { unwrapEvaluateResult } from './evaluate-result.js';

function isAuthLikeError(code, message) {
    const text = String(message ?? '');
    return code === 401 || code === 403 || /login|cookie|auth|captcha|verify|forbidden|permission|登录|登陆|权限|验证|验证码/i.test(text);
}

/**
 * Execute a fetch() call inside the Chrome browser context via page.evaluate.
 * This ensures a_bogus signing and cookies are handled automatically by the browser.
 */
export async function browserFetch(page, method, url, options = {}) {
    const js = `
    (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ${Number(options.timeoutMs ?? 30000)});
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
        try {
          return JSON.parse(text);
        } catch (error) {
          return { status_code: res.ok ? -2 : res.status, status_msg: \`JSON parse failed: \${text.slice(0, 500) || String(error && error.message || error)}\` };
        }
      } catch (error) {
        return { status_code: -1, status_msg: String(error && error.message || error) };
      } finally {
        clearTimeout(timer);
      }
    })()
  `;
    let result;
    try {
        result = unwrapEvaluateResult(await page.evaluate(js));
    }
    catch (error) {
        throw new CommandExecutionError(`Douyin API request failed (${method} ${url}): ${error instanceof Error ? error.message : String(error)}`);
    }
    if (result == null) {
        throw new CommandExecutionError(`Empty response from Douyin API (${method} ${url})`);
    }
    if (Array.isArray(result) || typeof result !== 'object') {
        throw new CommandExecutionError(`Malformed response from Douyin API (${method} ${url})`);
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
