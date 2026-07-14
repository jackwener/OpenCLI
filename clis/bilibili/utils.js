/**
 * Bilibili shared helpers: WBI signing, authenticated fetch, nav data, UID resolution.
 */
import https from 'node:https';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
/**
 * Resolve Bilibili short URL / short code to BV ID.
 * Supports: BV1MV9NBtENN, XYzsqGa, b23.tv/XYzsqGa, https://b23.tv/XYzsqGa
 */
export function resolveBvid(input) {
    const trimmed = String(input).trim();
    if (/^BV[A-Za-z0-9]+$/i.test(trimmed)) {
        return Promise.resolve(trimmed);
    }
    try {
        const parsed = new URL(trimmed);
        if (/(\.|^)bilibili\.com$/i.test(parsed.hostname)) {
            const match = parsed.pathname.match(/\/(?:video|bangumi\/play)\/(BV[A-Za-z0-9]+)/i);
            if (match) {
                return Promise.resolve(match[1]);
            }
        }
    }
    catch {
        // Non-URL inputs fall through to b23.tv short-code resolution.
    }
    const shortCode = trimmed.replace(/^https?:\/\//, '').replace(/^(www\.)?b23\.tv\//, '');
    if (!/^[A-Za-z0-9]+$/.test(shortCode)) {
        return Promise.reject(new Error(`Cannot resolve BV ID from invalid b23.tv short code: ${trimmed}`));
    }
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
        req.setTimeout(4000, () => { req.destroy(); reject(new Error(`Timeout resolving short URL: ${trimmed}`)); });
    });
}
/**
 * 解析 --page 选集序号（分P / 视频选集）。
 * 缺省/空串 → null（不下钻，保持整集默认 P1 旧行为）。
 * 非正十进制整数 → 抛 ArgumentError（参数错误，不静默吞）。
 */
export function parsePageArg(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number') {
        if (Number.isSafeInteger(value) && value >= 1) return value;
        throw new ArgumentError(`--page must be a positive decimal integer, got: ${value}`);
    }
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
        throw new ArgumentError(`--page must be a positive decimal integer, got: ${String(value)}`);
    }
    const n = Number(value);
    if (!Number.isSafeInteger(n)) {
        throw new ArgumentError(`--page is too large: ${value}`);
    }
    return n;
}

function readApiPositiveInteger(value, label) {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1) {
        return value;
    }
    if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) {
        const n = Number(value);
        if (Number.isSafeInteger(n)) return n;
    }
    throw new CommandExecutionError(`Bilibili view API returned a malformed ${label}`);
}

/**
 * 从 view API 的 data.pages 数组取第 N 集（1-based）。
 * page/cid 都以 view API 的 pages[] 为 source-of-truth；缺失、重复或畸形都 fail closed。
 * 返回该集 raw 对象（含 cid / part(分集标题) / page / duration）。
 */
export function selectVideoPart(viewData, pageNum) {
    const pages = Array.isArray(viewData?.pages) ? viewData.pages : null;
    if (!pages || pages.length === 0) {
        throw new CommandExecutionError('Bilibili view API did not return pages[] for --page selection');
    }
    const matches = [];
    for (const entry of pages) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            throw new CommandExecutionError('Bilibili view API returned a malformed pages[] entry');
        }
        const apiPage = readApiPositiveInteger(entry.page, 'page number');
        if (apiPage === pageNum) {
            matches.push(entry);
        }
    }
    if (matches.length > 1) {
        throw new CommandExecutionError(`Bilibili view API returned duplicate page entries for p=${pageNum}`);
    }
    const part = matches[0];
    if (!part) {
        const total = pages.length || viewData?.videos || 1;
        throw new CommandExecutionError(`分P 序号超出范围：p=${pageNum}（该视频共 ${total} 集）`);
    }
    readApiPositiveInteger(part.cid, `cid for p=${pageNum}`);
    return part;
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
/**
 * Bilibili write APIs return a JSON envelope `{ code, message, data }`. A non-zero
 * `code` carries either an auth/permission failure (login expired, CSRF rejected,
 * forbidden) or an application-level error (rate limit, validation, etc.). These
 * two helpers route the envelope to the right typed error so every write adapter
 * surfaces login problems as `AuthRequiredError`, not a generic execution error.
 */
export function isAuthLikeBilibiliError(code, message) {
    return code === -101 || code === -111 || code === -403 || /csrf|登录|账号|权限|forbidden|permission|login/i.test(String(message ?? ''));
}

export function requireOkPayload(payload, label) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Object.hasOwn(payload, 'code')) {
        throw new CommandExecutionError(`Bilibili ${label} API returned a malformed payload`);
    }
    if (payload.code !== 0) {
        const message = payload.message ?? 'unknown error';
        if (isAuthLikeBilibiliError(payload.code, message)) {
            throw new AuthRequiredError('bilibili.com', `Bilibili ${label} API requires login or permission: ${message} (${payload.code})`);
        }
        throw new CommandExecutionError(`Bilibili ${label} API failed: ${message} (${payload.code})`);
    }
    return payload.data;
}

/**
 * POST form-encoded params to a Bilibili API endpoint.
 * Runs inside the logged-in browser context and auto-attaches the bili_jct CSRF token,
 * which Bilibili requires on every authenticated write request.
 */
export async function apiPost(page, path, opts = {}) {
    const params = opts.params ?? {};
    const stringified = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]));
    const paramsJs = JSON.stringify(stringified);
    const urlJs = JSON.stringify(`https://api.bilibili.com${path}`);
    return page.evaluate(`
    async () => {
      const csrf = (document.cookie.match(/bili_jct=([^;]+)/) || [])[1] || "";
      const body = new URLSearchParams(${paramsJs});
      body.set("csrf", csrf);
      const res = await fetch(${urlJs}, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      // Bilibili write endpoints can return an HTML risk-control page (e.g. HTTP 412)
      // instead of JSON. Surface that as a structured error rather than a parse crash.
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        return { code: -1, message: "Non-JSON response (HTTP " + res.status + "): " + text.slice(0, 200) };
      }
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
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data) || !Object.hasOwn(payload.data, 'result')) {
        throw new CommandExecutionError(`Bilibili user search returned malformed result for ${input}`);
    }
    const results = payload.data.result;
    if (!Array.isArray(results)) {
        throw new CommandExecutionError(`Bilibili user search returned malformed result for ${input}`);
    }
    if (results.length > 0) {
        const mid = String(results[0]?.mid ?? '').trim();
        if (!mid) {
            throw new CommandExecutionError(`Bilibili user search returned malformed mid for ${input}`);
        }
        return mid;
    }
    throw new EmptyResultError(`bilibili user search: ${input}`, 'User may not exist or username may have changed.');
}
