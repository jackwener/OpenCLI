import {
    ArgumentError,
    AuthRequiredError,
    CommandExecutionError,
} from '@jackwener/opencli/errors';

export const API_ORIGIN = 'https://api-lpt.liepin.com';
export const LPT_ORIGIN = 'https://lpt.liepin.com';

const AUTH_CODES = new Set(['-1401', '-1701']);

export function textOrNull(value) {
    if (value === undefined || value === null) return null;
    if (typeof value === 'object') return null;
    const text = String(value).trim();
    return text || null;
}

export function positiveInteger(raw, name, defaultValue, maximum) {
    const value = raw === undefined || raw === null || raw === '' ? defaultValue : Number(raw);
    if (!Number.isInteger(value) || value < 1) {
        throw new ArgumentError(`liepin ${name} must be a positive integer`);
    }
    if (maximum !== undefined && value > maximum) {
        throw new ArgumentError(`liepin ${name} must be <= ${maximum}`);
    }
    return value;
}

export function requiredText(raw, name) {
    const value = textOrNull(raw);
    if (!value) throw new ArgumentError(`liepin ${name} is required`);
    return value;
}

export function requireConfirmation(raw, action) {
    if (raw !== true) {
        throw new ArgumentError(`liepin ${action} requires --confirm true`);
    }
}

export function absoluteResumeUrl(url, resumeId) {
    const value = textOrNull(url);
    if (value) {
        try {
            return new URL(value, LPT_ORIGIN).toString();
        } catch {
            return null;
        }
    }
    return resumeId
        ? `${LPT_ORIGIN}/resume/detail?resIdEncode=${encodeURIComponent(resumeId)}`
        : null;
}

function decodeCookie(value) {
    if (!value) return '';
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

export async function readCookieJar(page, extraDomains = []) {
    if (!page || typeof page.getCookies !== 'function') {
        throw new CommandExecutionError('Liepin command requires a browser page with cookie access');
    }

    const cookies = new Map();
    const domains = [
        ...extraDomains,
        'api-lpt.liepin.com',
        'lpt.liepin.com',
        '.liepin.com',
    ];
    for (const domain of domains) {
        try {
            for (const cookie of await page.getCookies({ domain }) || []) {
                if (!cookies.has(cookie.name)) cookies.set(cookie.name, cookie.value);
            }
        } catch {
            // CDP cookie scoping differs between browser implementations.
        }
    }

    if (cookies.size === 0) {
        throw new AuthRequiredError('lpt.liepin.com', '请先在当前浏览器登录猎聘企业版');
    }
    return cookies;
}

export async function fetchWithCookies(page, url, options = {}) {
    const target = new URL(url);
    let cookies = new Map();
    try {
        for (const cookie of await page.getCookies({ url: target.toString() }) || []) {
            cookies.set(cookie.name, cookie.value);
        }
    } catch {
        // Older bridge implementations may not support URL-scoped cookie reads.
    }
    if (cookies.size === 0) cookies = await readCookieJar(page, [target.hostname]);
    const cookieHeader = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    const xsrfToken = decodeCookie(cookies.get('XSRF-TOKEN'));
    let response;
    try {
        response = await fetch(url, {
            ...options,
            headers: {
                Accept: '*/*',
                'Accept-Language': 'zh-CN,zh;q=0.9',
                'User-Agent': 'Mozilla/5.0',
                Cookie: cookieHeader,
                ...(xsrfToken ? { 'X-XSRF-TOKEN': xsrfToken } : {}),
                ...options.headers,
            },
            redirect: 'follow',
        });
    } catch (error) {
        throw new CommandExecutionError(`Liepin request failed: ${error?.message || error}`);
    }
    if (!response.ok) {
        throw new CommandExecutionError(`Liepin request failed: HTTP ${response.status}`);
    }
    return response;
}

export async function postFormRaw(page, path, params, referer = `${LPT_ORIGIN}/search`) {
    const body = new URLSearchParams();
    for (const [name, value] of Object.entries(params || {})) {
        if (value !== undefined && value !== null && value !== '') body.set(name, String(value));
    }
    const url = /^https?:\/\//i.test(path) ? path : `${API_ORIGIN}${path}`;
    const response = await fetchWithCookies(page, url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            Origin: new URL(referer).origin,
            Referer: referer,
        },
        body,
    });

    let payload;
    try {
        payload = await response.json();
    } catch (error) {
        throw new CommandExecutionError(`Liepin returned invalid JSON: ${error?.message || error}`);
    }
    return payload;
}

export async function getRaw(page, path, params, referer = `${LPT_ORIGIN}/search`) {
    const url = new URL(/^https?:\/\//i.test(path) ? path : `${API_ORIGIN}${path}`);
    for (const [name, value] of Object.entries(params || {})) {
        if (value !== undefined && value !== null && value !== '') {
            url.searchParams.set(name, String(value));
        }
    }
    const response = await fetchWithCookies(page, url.toString(), {
        method: 'GET',
        headers: {
            'X-Requested-With': 'XMLHttpRequest',
            Referer: referer,
        },
    });

    try {
        return await response.json();
    } catch (error) {
        throw new CommandExecutionError(`Liepin returned invalid JSON: ${error?.message || error}`);
    }
}

export function assertApiSuccess(payload) {
    if (payload?.flag === 1) return payload;
    const code = payload?.code === undefined || payload?.code === null
        ? null
        : String(payload.code);
    const message = textOrNull(payload?.msg) ?? 'Liepin rejected the request';
    if (AUTH_CODES.has(code) || /登录|login/i.test(message)) {
        throw new AuthRequiredError('lpt.liepin.com', `猎聘登录态已失效：${message}`);
    }
    throw new CommandExecutionError(`Liepin API failed: ${message} (code=${code})`);
}

export async function postForm(page, path, params, referer) {
    return assertApiSuccess(await postFormRaw(page, path, params, referer));
}

export async function get(page, path, params, referer) {
    return assertApiSuccess(await getRaw(page, path, params, referer));
}

export function firstArray(payload, paths) {
    for (const path of paths) {
        let value = payload;
        for (const key of path) value = value?.[key];
        if (Array.isArray(value)) return value;
    }
    return null;
}

export function valueFrom(objects, keys) {
    for (const object of objects) {
        if (!object || typeof object !== 'object') continue;
        for (const key of keys) {
            const value = textOrNull(object[key]);
            if (value !== null) return value;
        }
    }
    return null;
}
