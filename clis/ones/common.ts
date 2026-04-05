/**
 * ONES 旧版 Project API — 经 Browser Bridge 在已登录标签页内 fetch（携带 Cookie）。
 * 文档：https://developer.ones.cn/zh-CN/docs/api/readme/
 */

import type { IPage } from '@jackwener/opencli/types';
import { CliError } from '@jackwener/opencli/errors';

export const API_PREFIX = '/project/api/project';

export function getOnesBaseUrl(): string {
  const u = process.env.ONES_BASE_URL?.trim().replace(/\/+$/, '');
  if (!u) {
    throw new CliError(
      'CONFIG',
      'Missing ONES_BASE_URL',
      'Set ONES_BASE_URL to your deployment origin, e.g. https://your-team.ones.cn (no trailing slash).',
    );
  }
  return u;
}

export function onesApiUrl(apiPath: string): string {
  const base = getOnesBaseUrl();
  const p = apiPath.replace(/^\/+/, '');
  return `${base}${API_PREFIX}/${p}`;
}

/** 打开 ONES 根地址，确保后续 fetch 与页面同源、带上登录 Cookie */
export async function gotoOnesHome(page: IPage): Promise<void> {
  await page.goto(getOnesBaseUrl(), { waitUntil: 'load' });
  await page.wait(2);
}

/**
 * 在页面内发起请求。默认带 credentials；若设置了 ONES_USER_ID + ONES_AUTH_TOKEN，则附加文档要求的 Header（与纯 Cookie 二选一或并存，取决于部署）。
 */
function buildHeaders(auth: boolean, includeJsonContentType: boolean): Record<string, string> {
  const ref = getOnesBaseUrl();
  const out: Record<string, string> = { Referer: ref };
  if (auth) {
    const uid =
      process.env.ONES_USER_ID?.trim() ||
      process.env.ONES_USER_UUID?.trim() ||
      process.env.Ones_User_Id?.trim();
    const tok = process.env.ONES_AUTH_TOKEN?.trim() || process.env.Ones_Auth_Token?.trim();
    if (uid && tok) {
      out['Ones-User-Id'] = uid;
      out['Ones-Auth-Token'] = tok;
    }
  }
  if (includeJsonContentType) out['Content-Type'] = 'application/json';
  return out;
}

export function summarizeOnesError(status: number, body: unknown): string {
  if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof o.type === 'string') parts.push(o.type);
    if (typeof o.reason === 'string') parts.push(o.reason);
    if (typeof o.errcode === 'string') parts.push(o.errcode);
    if (typeof o.message === 'string') parts.push(o.message);
    if (o.code !== undefined && o.code !== null) parts.push(`code=${String(o.code)}`);
    if (parts.length) return parts.filter(Boolean).join(' · ');
  }
  return status === 401 ? 'Unauthorized' : `HTTP ${status}`;
}

/** ONES 部分接口 HTTP 200 但 body 仍为错误（如 reason: ServerError） */
function throwIfOnesPeekBusinessError(apiPath: string, parsed: unknown): void {
  if (parsed === null || typeof parsed !== 'object') return;
  const o = parsed as Record<string, unknown>;
  if (Array.isArray(o.groups)) return;
  const hasErr =
    (typeof o.reason === 'string' && o.reason.length > 0) ||
    (typeof o.errcode === 'string' && o.errcode.length > 0) ||
    (typeof o.type === 'string' && o.type.length > 0);
  if (!hasErr) return;
  const detail = summarizeOnesError(200, parsed);
  throw new CliError(
    'FETCH_ERROR',
    `ONES ${apiPath}: ${detail}`,
    '若 query 不合法会返回 ServerError；可试 opencli ones tasks（空 must）或检查筛选器文档。响应全文可用 -v 或临时打日志。',
  );
}

export async function onesFetchInPageWithMeta(
  page: IPage,
  apiPath: string,
  options: {
    method?: string;
    body?: string | null;
    auth?: boolean;
    skipGoto?: boolean;
  } = {},
): Promise<{ ok: boolean; status: number; parsed: unknown }> {
  if (!options.skipGoto) {
    await gotoOnesHome(page);
  }

  const url = onesApiUrl(apiPath);
  const method = (options.method ?? 'GET').toUpperCase();
  const auth = options.auth !== false;
  const body = options.body ?? null;
  const includeCt = body !== null || method === 'POST' || method === 'PUT' || method === 'PATCH';
  const headers = buildHeaders(auth, includeCt);

  const urlJs = JSON.stringify(url);
  const methodJs = JSON.stringify(method);
  const headersJs = JSON.stringify(headers);
  const bodyJs = body === null ? 'null' : JSON.stringify(body);

  const raw = await page.evaluate(`
    (async () => {
      const url = ${urlJs};
      const method = ${methodJs};
      const headers = ${headersJs};
      const body = ${bodyJs};
      const init = {
        method,
        headers: { ...headers },
        credentials: 'include',
      };
      if (body !== null) init.body = body;
      const res = await fetch(url, init);
      const text = await res.text();
      let parsed = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = text;
      }
      return { ok: res.ok, status: res.status, parsed };
    })()
  `);

  return raw as { ok: boolean; status: number; parsed: unknown };
}

/** 当前操作用户 8 位 uuid（Header 或 GET users/me） */
export async function resolveOnesUserUuid(page: IPage, opts?: { skipGoto?: boolean }): Promise<string> {
  const fromEnv =
    process.env.ONES_USER_ID?.trim() ||
    process.env.ONES_USER_UUID?.trim() ||
    process.env.Ones_User_Id?.trim();
  if (fromEnv) return fromEnv;

  const data = (await onesFetchInPage(page, 'users/me', { skipGoto: opts?.skipGoto })) as Record<string, unknown>;
  const u = data.user && typeof data.user === 'object' ? (data.user as Record<string, unknown>) : data;
  if (!u || typeof u.uuid !== 'string') {
    throw new CliError(
      'FETCH_ERROR',
      'Could not read current user uuid from users/me',
      'Set ONES_USER_ID or ensure Chrome is logged in; try: opencli ones me -f json',
    );
  }
  return String(u.uuid);
}

export async function onesFetchInPage(
  page: IPage,
  apiPath: string,
  options: {
    method?: string;
    body?: string | null;
    auth?: boolean;
    /** 已在 ONES 根页时设为 true，避免每条 API 都 goto+wait（显著提速） */
    skipGoto?: boolean;
  } = {},
): Promise<unknown> {
  const r = await onesFetchInPageWithMeta(page, apiPath, options);
  if (!r.ok) {
    const detail = summarizeOnesError(r.status, r.parsed);
    const hint =
      r.status === 401
        ? '在 Chrome 中打开 ONES 并登录；或先执行 opencli ones login 后按提示 export ONES_USER_ID / ONES_AUTH_TOKEN；并确认 ONES_BASE_URL 与浏览器地址一致。'
        : '检查 ONES_BASE_URL、VPN/内网，以及实例是否仍为 Project API 路径。';
    throw new CliError('FETCH_ERROR', `ONES ${apiPath}: ${detail}`, hint);
  }

  if (apiPath.includes('/filters/peek')) {
    throwIfOnesPeekBusinessError(apiPath, r.parsed);
  }

  return r.parsed;
}
