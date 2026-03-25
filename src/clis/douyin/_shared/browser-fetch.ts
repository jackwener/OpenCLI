import type { IPage } from '../../../types.js';
import { CommandExecutionError } from '../../../errors.js';

export interface FetchOptions {
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * Execute a fetch() call inside the Chrome browser context via page.evaluate.
 * This ensures a_bogus signing and cookies are handled automatically by the browser.
 */
export async function browserFetch(
  page: IPage,
  method: 'GET' | 'POST',
  url: string,
  options: FetchOptions = {}
): Promise<unknown> {
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
      return res.json();
    })()
  `;

  const result = await page.evaluate(js);

  if (result && typeof result === 'object' && 'status_code' in result) {
    const code = (result as { status_code: number }).status_code;
    if (code !== 0) {
      const msg = (result as { status_msg?: string }).status_msg ?? 'unknown error';
      throw new CommandExecutionError(`Douyin API error ${code}: ${msg}`);
    }
  }

  return result;
}
