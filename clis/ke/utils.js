import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

const CAPTCHA_TEXT_PATTERNS = [
    '请拖动下方滑块完成验证',
    '请按住滑块',
    '验证码',
    '安全验证',
    '访问验证',
    '滑动验证',
];

const LOGIN_TEXT_PATTERNS = [
    '请登录',
    '登录后',
    '账号登录',
    '手机登录',
    '立即登录',
    '扫码登录',
];

function cleanText(value) {
    return typeof value === 'string'
        ? value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
        : '';
}

export async function readPageState(page) {
    const result = await page.evaluate(`
    (() => {
      try {
        return {
          href: window.location.href || '',
          title: document.title || '',
          body_text: document.body ? (document.body.innerText || '').substring(0, 2000) : '',
        };
      } catch(e) {
        return { href: '', title: '', body_text: '' };
      }
    })()
  `);
    if (!result) {
        return { href: '', title: '', body_text: '' };
    }
    return {
        href: cleanText(result.href),
        title: cleanText(result.title),
        body_text: cleanText(result.body_text),
    };
}

export function assertNotBlocked(state) {
    const { href, title, body_text } = state;
    if (href.includes('hip.ke.com/captcha') || href.includes('/captcha')) {
        throw new AuthRequiredError('ke.com', '触发了验证码，请先在浏览器中完成验证');
    }
    if (CAPTCHA_TEXT_PATTERNS.some(p => title.includes(p) || body_text.includes(p))) {
        throw new AuthRequiredError('ke.com', '触发了验证码，请先在浏览器中完成滑块验证');
    }
    if (LOGIN_TEXT_PATTERNS.some(p => title.includes(p))) {
        throw new AuthRequiredError('ke.com', '未登录，请先在浏览器中登录贝壳找房');
    }
}

export async function gotoKe(page, url) {
    await page.goto(url, { settleMs: 2500 });
    await page.wait(2);
    const state = await readPageState(page);
    assertNotBlocked(state);
    return state;
}

/**
 * Fetch a ke.com JSON API from inside the browser context (credentials included).
 */
export async function fetchKeJson(page, url) {
    const result = await page.evaluate(`(async () => {
    const res = await fetch(${JSON.stringify(url)}, { credentials: 'include' });
    if (!res.ok) return { __keErr: res.status };
    try {
      return await res.json();
    } catch {
      return { __keErr: 'parse' };
    }
  })()`);
    const r = result;
    if (r?.__keErr !== undefined) {
        const code = r.__keErr;
        if (code === 401 || code === 403) {
            throw new AuthRequiredError('ke.com', '未登录或登录已过期，请先在浏览器中登录贝壳找房');
        }
        if (code === 'parse') {
            throw new CommandExecutionError('响应不是有效 JSON', '可能触发了风控，请检查登录状态或稍后重试');
        }
        throw new CommandExecutionError(`HTTP ${code}`, '请检查网络连接或登录状态');
    }
    return result;
}

/**
 * Build a ke.com city URL prefix. Default city is 'bj' (Beijing).
 */
export function cityUrl(city) {
    return `https://${city}.ke.com`;
}
