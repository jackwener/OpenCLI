import { CommandExecutionError } from '@jackwener/opencli/errors';
/**
 * Execute a fetch() call inside the Chrome browser context via page.evaluate.
 * This ensures a_bogus signing and cookies are handled automatically by the browser.
 */
export async function browserFetch(page, method, url, options = {}) {
    const js = `
    (async () => {
      const res = await fetch(${JSON.stringify(url)}, {
        method: ${JSON.stringify(method)},
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...${JSON.stringify(options.headers ?? {})}
        },
        ${options.body ? `body: JSON.stringify(${JSON.stringify(options.body)}),` : ''}
      });
      const text = await res.text();
      if (!text) return null;
      return JSON.parse(text);
    })()
  `;
    let result;
    try {
        result = await page.evaluate(js);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new CommandExecutionError(`Douyin API request failed: ${message}`);
    }
    if (result === null || result === undefined) {
        throw new CommandExecutionError('Empty response from Douyin API');
    }
    if (result && typeof result === 'object' && 'status_code' in result) {
        const code = result.status_code;
        if (code !== 0) {
            const msg = result.status_msg ?? 'unknown error';
            throw new CommandExecutionError(`Douyin API error ${code}: ${msg}`);
        }
    }
    return result;
}
