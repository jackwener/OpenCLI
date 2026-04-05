import type { IPage } from '@jackwener/opencli/types';
import { AuthRequiredError } from '@jackwener/opencli/errors';

export const YUANBAO_DOMAIN = 'yuanbao.tencent.com';
export const YUANBAO_URL = 'https://yuanbao.tencent.com/';

const SESSION_HINT = 'Likely login/auth/challenge/session issue in the existing yuanbao.tencent.com browser session.';

/**
 * Reusable visibility check for injected browser scripts.
 * Embed in page.evaluate strings via `${IS_VISIBLE_JS}`.
 */
export const IS_VISIBLE_JS = `const isVisible = (node) => {
  if (!(node instanceof HTMLElement)) return false;
  const rect = node.getBoundingClientRect();
  const style = window.getComputedStyle(node);
  return rect.width > 0
    && rect.height > 0
    && style.display !== 'none'
    && style.visibility !== 'hidden';
};`;

export function authRequired(message: string) {
  return new AuthRequiredError(YUANBAO_DOMAIN, `${message} ${SESSION_HINT}`);
}

export async function isOnYuanbao(page: IPage): Promise<boolean> {
  const url = await page.evaluate('window.location.href').catch(() => '');
  if (typeof url !== 'string' || !url) return false;

  try {
    const hostname = new URL(url).hostname;
    return hostname === YUANBAO_DOMAIN || hostname.endsWith(`.${YUANBAO_DOMAIN}`);
  } catch {
    return false;
  }
}

export async function ensureYuanbaoPage(page: IPage): Promise<void> {
  if (!(await isOnYuanbao(page))) {
    await page.goto(YUANBAO_URL, { waitUntil: 'load', settleMs: 2500 });
    await page.wait(1);
  }
}

export async function hasLoginGate(page: IPage): Promise<boolean> {
  const result = await page.evaluate(`(() => {
    const bodyText = document.body.innerText || '';
    const hasWechatLoginText = bodyText.includes('微信扫码登录');
    const hasWechatIframe = Array.from(document.querySelectorAll('iframe'))
      .some((frame) => (frame.getAttribute('src') || '').includes('open.weixin.qq.com/connect/qrconnect'));

    return hasWechatLoginText || hasWechatIframe;
  })()`);

  return Boolean(result);
}
