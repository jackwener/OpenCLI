import { CommandExecutionError } from '@jackwener/opencli/errors';
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
          return { status_code: res.ok ? 0 : res.status, status_msg: text.slice(0, 500) || String(error && error.message || error) };
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
        result = await page.evaluate(js);
    }
    catch (error) {
        throw new CommandExecutionError(`Douyin API request failed (${method} ${url}): ${error instanceof Error ? error.message : String(error)}`);
    }
    if (result == null) {
        throw new CommandExecutionError(`Empty response from Douyin API (${method} ${url})`);
    }
    if (result && typeof result === 'object' && 'status_code' in result) {
        const code = result.status_code;
        if (code !== 0) {
            const msg = result.status_msg ?? result.message ?? 'unknown error';
            throw new CommandExecutionError(`Douyin API error ${code} at ${method} ${url}: ${msg}`);
        }
    }
    return result;
}
