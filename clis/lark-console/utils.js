// Helpers for the Lark Open Platform developer-console adapter.
//
// The developer console (https://open.larksuite.com/app) is a SPA backed by
// same-origin JSON services under `/developers/v1/...` and `/napi/...`. They
// authenticate off the logged-in session cookie. The `/developers/v1` endpoints
// additionally require an `x-csrf-token` request header whose value the console
// publishes as the `window.csrfToken` global on every console page — the raw
// `_csrf_token` / `lark_oapi_csrf_token` cookies do NOT satisfy the check.
// consoleApi() reproduces exactly that from inside the bound tab.
//
// Feishu (https://open.feishu.cn/app) exposes the identical API surface; only the
// host differs. This adapter targets Lark so every command can be verified against
// a real logged-in account — swapping LARK is all a Feishu variant would need.
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

export const LARK = 'open.larksuite.com';

// Navigate the bound tab onto the console (where the session cookie + window.csrfToken
// live) if it isn't already there.
export async function ensureConsole(page, host = LARK) {
  const url = await page.evaluate('() => location.href');
  if (typeof url !== 'string' || !url.includes(`://${host}/`)) {
    await page.goto(`https://${host}/app`);
    await page.wait(2);
  }
}

// Call a console JSON endpoint through the logged-in browser context and return the
// inner `data` payload of the `{ code, data, msg }` envelope. `/developers/v1` paths
// need the x-csrf-token header (window.csrfToken); `/napi` paths use the cookie alone.
// opts: { method = 'GET', body } — body is JSON-serialised for POST requests.
export async function consoleApi(page, host, path, opts = {}) {
  const method = opts.method || 'GET';
  const body = opts.body != null ? JSON.stringify(opts.body) : null;
  const res = await page.evaluate(`(async () => {
    const csrf = (typeof window.csrfToken === 'string') ? window.csrfToken : '';
    try {
      const headers = { 'Accept': 'application/json' };
      if (csrf) headers['x-csrf-token'] = csrf;
      const init = { method: ${JSON.stringify(method)}, credentials: 'include', headers };
      ${body != null ? `headers['Content-Type'] = 'application/json'; init.body = ${JSON.stringify(body)};` : ''}
      const r = await fetch('https://' + ${JSON.stringify(host)} + ${JSON.stringify(path)}, init);
      const text = await r.text();
      let data = null; try { data = JSON.parse(text); } catch (e) {}
      return { status: r.status, hasCsrf: !!csrf, data, raw: data == null ? text.slice(0, 200) : null };
    } catch (e) { return { fetchError: String(e).slice(0, 160) }; }
  })()`);

  if (!res) throw new CommandExecutionError('Lark console request returned no response.');
  if (res.fetchError) throw new CommandExecutionError(`Lark console request failed: ${res.fetchError}`);
  if (res.status === 401 || res.status === 403) {
    throw new AuthRequiredError(host, `Lark console session expired or unauthorized. Sign in at https://${host}/app via the bound Chrome tab, then retry.`);
  }
  // A signed-out console redirects to an HTML login page, so JSON parsing fails.
  if (res.data == null) {
    throw new AuthRequiredError(host, `Not logged into the ${host} developer console. Sign in at https://${host}/app via the bound Chrome tab, then retry.`);
  }
  const envelope = res.data;
  if (typeof envelope.code === 'number' && envelope.code !== 0) {
    const msg = envelope.msg || `code ${envelope.code}`;
    if (!res.hasCsrf || /csrf|login|not exist|unauthor|token/i.test(msg)) {
      throw new AuthRequiredError(host, `Lark console rejected the request (${msg}). Reload https://${host}/app in the bound Chrome tab to refresh the session, then retry.`);
    }
    throw new CommandExecutionError(`Lark console API error (${msg}).`);
  }
  if (res.status >= 400) {
    throw new CommandExecutionError(`Lark console API ${res.status}${res.raw ? `: ${res.raw}` : ''}`);
  }
  return Object.prototype.hasOwnProperty.call(envelope, 'data') ? envelope.data : envelope;
}

// Resolve the current developer-console login (user + tenant) off the cookie.
export async function getIdentity(page, host = LARK) {
  const data = await consoleApi(page, host, '/napi/check/login', { method: 'POST', body: {} });
  if (!data || !data.id) {
    throw new AuthRequiredError(host, `Not logged into the ${host} developer console. Sign in at https://${host}/app via the bound Chrome tab, then retry.`);
  }
  return { user_id: data.id, tenant_id: data.tenantId || '' };
}

// ── pure formatters (unit-tested) ───────────────────────────────────────

// Accept a bare `cli_…` app id, a console URL, or any string embedding the id.
export function normalizeAppId(input) {
  if (input == null) return '';
  const match = String(input).match(/cli_[0-9a-zA-Z]+/);
  return match ? match[0] : String(input).trim();
}

// Lark timestamps are unix seconds. Render a stable UTC stamp (empty for missing).
export function fmtUnix(sec) {
  const n = Number(sec);
  if (!n || Number.isNaN(n)) return '';
  const d = new Date(n * 1000);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

export function truncate(value, max = 80) {
  const s = (value == null ? '' : String(value)).replace(/\s+/g, ' ').trim();
  if (max <= 0 || s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

export function joinList(value) {
  if (!Array.isArray(value)) return '';
  return value.filter(Boolean).join(',');
}

// app/list `role` is the current user's role on that app: 1 = owner, anything else
// is a non-owning collaborator (admin/member). We only assert the value we verified.
export function roleLabel(role) {
  return Number(role) === 1 ? 'owner' : 'collaborator';
}

// app_version `versionStatus` 2 is the live/online version. Other codes are
// historical/under-review states we don't claim to decode, so we only flag "online".
export function isOnlineVersion(versionStatus) {
  return Number(versionStatus) === 2;
}

// Scope-write inputs are comma/space-separated names or ids.
export function splitScopes(value) {
  return String(value == null ? '' : value).split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}

// ── write helpers ───────────────────────────────────────────────────────

// Mutating commands refuse to run without --execute.
export function requireExecute(kwargs, action) {
  if (!kwargs || kwargs.execute !== true) {
    throw new ArgumentError(`Refusing to ${action} without --execute. Re-run with --execute to actually perform this.`);
  }
}

// Resolve scope name(s) (e.g. "im:message") or numeric id(s) to numeric scope ids
// against the app's full scope catalog. Throws listing any token that doesn't match.
export async function resolveScopeIds(page, host, appId, tokens) {
  const catalog = await consoleApi(page, host, `/developers/v1/scope/all/${appId}`, { method: 'POST', body: {} });
  const scopes = catalog && Array.isArray(catalog.scopes) ? catalog.scopes : [];
  if (scopes.length === 0) {
    throw new CommandExecutionError(`Could not load the scope catalog for ${appId}.`);
  }
  const byName = new Map();
  const knownIds = new Set();
  for (const s of scopes) {
    if (s && s.name) byName.set(String(s.name), String(s.id));
    if (s && s.id != null) knownIds.add(String(s.id));
  }
  const resolved = [];
  const unknown = [];
  for (const token of tokens) {
    const t = String(token).trim();
    if (!t) continue;
    if (/^\d+$/.test(t) && knownIds.has(t)) resolved.push(t);
    else if (byName.has(t)) resolved.push(byName.get(t));
    else unknown.push(t);
  }
  if (unknown.length) {
    throw new ArgumentError(`Unknown scope(s): ${unknown.join(', ')}. Pass scope names (e.g. im:message) or numeric ids — run \`opencli lark-console scopes <app>\` to see ids.`);
  }
  if (resolved.length === 0) throw new ArgumentError('No scopes given.');
  return [...new Set(resolved)];
}

// Apply ('add') or remove ('del') tenant-token scope ids on an app's draft config.
// Mirrors the console exactly: ids go in appScopeIDs, the other arrays stay empty,
// so a scope added this way is removable the same way (the API keys off the slot).
export async function updateScopes(page, host, appId, ids, operation) {
  return consoleApi(page, host, `/developers/v1/scope/update/${appId}`, {
    method: 'POST',
    body: { appScopeIDs: ids, userScopeIDs: [], scopeIds: [], operation },
  });
}
