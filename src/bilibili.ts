/**
 * Bilibili shared helpers: WBI signing, authenticated fetch, nav data, UID resolution.
 */

import type { IPage } from './types.js';

const MIXIN_KEY_ENC_TAB = [
  46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,
  33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,
  61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,
  36,20,34,44,52,
];

export function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').trim();
}

export function payloadData(payload: any): any {
  return payload?.data ?? payload;
}

async function getNavData(page: IPage): Promise<any> {
  return page.evaluate(`
    async () => {
      const res = await fetch('https://api.bilibili.com/x/web-interface/nav', { credentials: 'include' });
      return await res.json();
    }
  `);
}

async function getWbiKeys(page: IPage): Promise<{ imgKey: string; subKey: string }> {
  const nav = await getNavData(page);
  const wbiImg = nav?.data?.wbi_img ?? {};
  const imgUrl = wbiImg.img_url ?? '';
  const subUrl = wbiImg.sub_url ?? '';
  const imgKey = imgUrl.split('/').pop()?.split('.')[0] ?? '';
  const subKey = subUrl.split('/').pop()?.split('.')[0] ?? '';
  return { imgKey, subKey };
}

function getMixinKey(imgKey: string, subKey: string): string {
  const raw = imgKey + subKey;
  return MIXIN_KEY_ENC_TAB.map(i => raw[i] || '').join('').slice(0, 32);
}

async function md5(text: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('md5').update(text).digest('hex');
}

export async function wbiSign(
  page: IPage,
  params: Record<string, any>,
): Promise<Record<string, string>> {
  const { imgKey, subKey } = await getWbiKeys(page);
  const mixinKey = getMixinKey(imgKey, subKey);
  const wts = Math.floor(Date.now() / 1000);
  const sorted: Record<string, string> = {};
  const allParams = { ...params, wts: String(wts) };
  for (const key of Object.keys(allParams).sort()) {
    sorted[key] = String(allParams[key]).replace(/[!'()*]/g, '');
  }
  const query = new URLSearchParams(sorted).toString();
  const wRid = await md5(query + mixinKey);
  sorted.w_rid = wRid;
  return sorted;
}

export async function apiGet(
  page: IPage,
  path: string,
  opts: { params?: Record<string, any>; signed?: boolean } = {},
): Promise<any> {
  const baseUrl = 'https://api.bilibili.com';
  let params = opts.params ?? {};
  if (opts.signed) {
    params = await wbiSign(page, params);
  }
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  );
  const url = `${baseUrl}${path}?${qs}`;
  return fetchJson(page, url);
}

export async function fetchJson(page: IPage, url: string): Promise<any> {
  const escapedUrl = url.replace(/"/g, '\\"');
  return page.evaluate(`
    async () => {
      const res = await fetch("${escapedUrl}", { credentials: "include" });
      return await res.json();
    }
  `);
}

export async function getSelfUid(page: IPage): Promise<string> {
  const nav = await getNavData(page);
  const mid = nav?.data?.mid;
  if (!mid) throw new Error('Not logged in to Bilibili');
  return String(mid);
}

export async function resolveUid(page: IPage, input: string): Promise<string> {
  if (/^\d+$/.test(input)) return input;
  // Search for user by name
  const payload = await apiGet(page, '/x/web-interface/wbi/search/type', {
    params: { search_type: 'bili_user', keyword: input },
    signed: true,
  });
  const results = payload?.data?.result ?? [];
  if (results.length > 0) return String(results[0].mid);
  throw new Error(`Cannot resolve UID for: ${input}`);
}
