import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

const CHINA_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

/** Format a Unix ms timestamp as the matching `YYYY-MM-DD` in Asia/Shanghai (xueqiu's canonical user timezone for all markets). */
export function formatChinaDate(ts) {
    if (ts == null) return null;
    const parts = Object.fromEntries(
        CHINA_DATE_FORMATTER.formatToParts(new Date(ts))
            .filter((part) => part.type !== 'literal')
            .map((part) => [part.type, part.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * Fetch a xueqiu JSON API from inside the browser context (credentials included).
 * Page must already be navigated to xueqiu.com before calling this function.
 * Throws CliError on HTTP errors; otherwise returns the parsed JSON.
 */
export async function fetchXueqiuJson(page, url) {
    const result = await page.evaluate(`(async () => {
    const res = await fetch(${JSON.stringify(url)}, { credentials: 'include' });
    if (!res.ok) return { __xqErr: res.status };
    try {
      return await res.json();
    } catch {
      return { __xqErr: 'parse' };
    }
  })()`);
    const r = result;
    if (r?.__xqErr !== undefined) {
        const code = r.__xqErr;
        if (code === 401 || code === 403) {
            throw new AuthRequiredError('xueqiu.com', '未登录或登录已过期');
        }
        if (code === 'parse') {
            throw new CommandExecutionError('响应不是有效 JSON', '可能触发了风控，请检查登录状态或稍后重试');
        }
        throw new CommandExecutionError(`HTTP ${code}`, '请检查网络连接或登录状态');
    }
    return result;
}
