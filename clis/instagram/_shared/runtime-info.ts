import type { BrowserCookie, IPage } from '../../../types.js';

export interface InstagramRuntimeInfo {
  appId: string;
  csrfToken: string;
  instagramAjax: string;
}

function pickMatch(input: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (!match) continue;
    for (let index = 1; index < match.length; index += 1) {
      if (match[index]) return match[index]!;
    }
    return match[0] || '';
  }
  return '';
}

export function extractInstagramRuntimeInfo(html: string): InstagramRuntimeInfo {
  return {
    appId: pickMatch(html, [
      /"X-IG-App-ID":"(\d+)"/,
      /"appId":"(\d+)"/,
      /"app_id":"(\d+)"/,
      /"instagramWebAppId":"(\d+)"/,
    ]),
    csrfToken: pickMatch(html, [
      /"csrf_token":"([^"]+)"/,
      /"csrfToken":"([^"]+)"/,
    ]),
    instagramAjax: pickMatch(html, [
      /"rollout_hash":"([^"]+)"/,
      /"X-Instagram-AJAX":"([^"]+)"/,
      /"Instagram-AJAX":"([^"]+)"/,
    ]),
  };
}

export function buildReadInstagramRuntimeInfoJs(): string {
  return `
    (() => {
      const html = document.documentElement?.outerHTML || '';
      const pick = (patterns) => {
        for (const pattern of patterns) {
          const match = html.match(new RegExp(pattern, 'i'));
          if (!match) continue;
          for (let index = 1; index < match.length; index += 1) {
            if (match[index]) return match[index];
          }
          return match[0] || '';
        }
        return '';
      };
      return {
        appId: pick([
          '"X-IG-App-ID":"(\\\\d+)"',
          '"appId":"(\\\\d+)"',
          '"app_id":"(\\\\d+)"',
          '"instagramWebAppId":"(\\\\d+)"',
        ]),
        csrfToken: pick([
          '"csrf_token":"([^"]+)"',
          '"csrfToken":"([^"]+)"',
        ]),
        instagramAjax: pick([
          '"rollout_hash":"([^"]+)"',
          '"X-Instagram-AJAX":"([^"]+)"',
          '"Instagram-AJAX":"([^"]+)"',
        ]),
      };
    })()
  `;
}

function getCookieValue(cookies: BrowserCookie[], name: string): string {
  return cookies.find((cookie) => cookie.name === name)?.value || '';
}

export async function resolveInstagramRuntimeInfo(page: IPage): Promise<InstagramRuntimeInfo> {
  const [runtime, cookies] = await Promise.all([
    page.evaluate(buildReadInstagramRuntimeInfoJs()) as Promise<InstagramRuntimeInfo>,
    page.getCookies({ domain: 'instagram.com' }),
  ]);
  return {
    appId: runtime?.appId || '',
    csrfToken: runtime?.csrfToken || getCookieValue(cookies, 'csrftoken') || '',
    instagramAjax: runtime?.instagramAjax || '',
  };
}
