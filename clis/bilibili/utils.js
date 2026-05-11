/**
 * Bilibili shared helpers: WBI signing, authenticated fetch, nav data, UID resolution.
 */
import https from 'node:https';
import { AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';
/**
 * Resolve Bilibili short URL / short code to BV ID.
 * Supports: BV1MV9NBtENN, XYzsqGa, b23.tv/XYzsqGa, https://b23.tv/XYzsqGa
 */
export function resolveBvid(input) {
    const trimmed = String(input).trim();
    if (/^BV[A-Za-z0-9]+$/i.test(trimmed)) {
        return Promise.resolve(trimmed);
    }
    const shortCode = trimmed.replace(/^https?:\/\//, '').replace(/^(www\.)?b23\.tv\//, '');
    const url = 'https://b23.tv/' + shortCode;
    return new Promise((resolve, reject) => {
        const req = https.get(url, (res) => {
            const location = res.headers.location;
            if (location) {
                const match = location.match(/\/video\/(BV[A-Za-z0-9]+)/);
                if (match) {
                    res.resume();
                    resolve(match[1]);
                    return;
                }
            }
            res.resume();
            reject(new Error(`Cannot resolve BV ID from short URL: ${trimmed}`));
        });
        req.on('error', reject);
        req.setTimeout(5000, () => { req.destroy(); reject(new Error(`Timeout resolving short URL: ${trimmed}`)); });
    });
}
const MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
    33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
    61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
    36, 20, 34, 44, 52,
];
export function stripHtml(s) {
    return s.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').trim();
}
export function payloadData(payload) {
    return payload?.data ?? payload;
}
async function getNavData(page) {
    return page.evaluate(`
    async () => {
      const res = await fetch('https://api.bilibili.com/x/web-interface/nav', { credentials: 'include' });
      return await res.json();
    }
  `);
}
async function getWbiKeys(page) {
    const nav = await getNavData(page);
    const wbiImg = nav?.data?.wbi_img ?? {};
    const imgUrl = wbiImg.img_url ?? '';
    const subUrl = wbiImg.sub_url ?? '';
    const imgKey = imgUrl.split('/').pop()?.split('.')[0] ?? '';
    const subKey = subUrl.split('/').pop()?.split('.')[0] ?? '';
    return { imgKey, subKey };
}
function getMixinKey(imgKey, subKey) {
    const raw = imgKey + subKey;
    return MIXIN_KEY_ENC_TAB.map(i => raw[i] || '').join('').slice(0, 32);
}
async function md5(text) {
    const { createHash } = await import('node:crypto');
    return createHash('md5').update(text).digest('hex');
}
export async function wbiSign(page, params) {
    const { imgKey, subKey } = await getWbiKeys(page);
    const mixinKey = getMixinKey(imgKey, subKey);
    const wts = Math.floor(Date.now() / 1000);
    const sorted = {};
    const allParams = { ...params, wts: String(wts) };
    for (const key of Object.keys(allParams).sort()) {
        sorted[key] = String(allParams[key]).replace(/[!'()*]/g, '');
    }
    // Bilibili WBI verification expects %20 for spaces, not + (URLSearchParams default).
    // Using + causes signature mismatch → CORS-blocked error response → TypeError: Failed to fetch.
    const query = new URLSearchParams(sorted).toString().replace(/\+/g, '%20');
    const wRid = await md5(query + mixinKey);
    sorted.w_rid = wRid;
    return sorted;
}
export async function apiGet(page, path, opts = {}) {
    const baseUrl = 'https://api.bilibili.com';
    let params = opts.params ?? {};
    if (opts.signed) {
        params = await wbiSign(page, params);
    }
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))).toString().replace(/\+/g, '%20');
    const url = `${baseUrl}${path}?${qs}`;
    return fetchJson(page, url);
}
export async function fetchJson(page, url) {
    const urlJs = JSON.stringify(url);
    return page.evaluate(`
    async () => {
      const res = await fetch(${urlJs}, { credentials: "include" });
      return await res.json();
    }
  `);
}
export async function getSelfUid(page) {
    const nav = await getNavData(page);
    const mid = nav?.data?.mid;
    if (!mid)
        throw new AuthRequiredError('bilibili.com');
    return String(mid);
}
export async function resolveUid(page, input) {
    if (/^\d+$/.test(input))
        return input;
    // Search for user by name
    const payload = await apiGet(page, '/x/web-interface/wbi/search/type', {
        params: { search_type: 'bili_user', keyword: input },
        signed: true,
    });
    const results = payload?.data?.result ?? [];
    if (results.length > 0)
        return String(results[0].mid);
    throw new EmptyResultError(`bilibili user search: ${input}`, 'User may not exist or username may have changed.');
}
