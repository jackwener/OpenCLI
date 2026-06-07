import { UUID_RE } from './resolve.js';

// ── Reusable in-page snippet fragments ──────────────────────────────────────
// Every slock command runs a string of JS inside the logged-in page via
// page.evaluate. The auth handshake (read token from localStorage), the
// server-scope resolution (slug → X-Server-Id), and the channel-name → id
// lookup were copy-pasted into every command. These fragments are the single
// source of truth so a new command composes them instead of re-deriving them.
//
// Envelope contract (what a snippet returns):
//   { kind: 'ok', rows, meta? }   { kind: 'auth', detail }
//   { kind: 'http', status, where }   { kind: 'no-server', detail }
//   { kind: 'unresolvable', detail }
// See errors.js#dispatchEvaluateResult for how these map to typed errors.

// Emits JS that leaves `token`, `sid` (null unless server-scoped) and `headers`
// in scope on success, or `return`s an error envelope. Run it first in a snippet.
export function authHeadersFragment({ serverScoped = false, serverIdOverride = null } = {}) {
  const overrideSid = serverIdOverride ? JSON.stringify(serverIdOverride) : 'null';
  const resolveServer = serverScoped
    ? `
    if (!sid) {
      const slug = localStorage.getItem('slock_last_server_slug');
      if (!slug) return { kind: 'no-server', detail: 'localStorage.slock_last_server_slug is empty; run \`slock server-use <slug>\`' };
      const sres = await fetch('/api/servers/', {
        method: 'GET', credentials: 'include',
        headers: { authorization: 'Bearer ' + token, accept: 'application/json' },
      });
      if (sres.status === 401) return { kind: 'auth', detail: '/servers/ returned 401' };
      if (!sres.ok) return { kind: 'http', status: sres.status, where: '/servers/' };
      const slist = await sres.json();
      const sm = (Array.isArray(slist) ? slist : []).find((s) => s && s.slug === slug);
      if (!sm) return { kind: 'no-server', detail: 'slug "' + slug + '" not in /servers/ — refresh in browser?' };
      sid = sm.id;
    }`
    : '';
  return `
    const token = localStorage.getItem('slock_access_token');
    if (!token) return { kind: 'auth', detail: 'no access token in localStorage' };
    let sid = ${overrideSid};${resolveServer}
    const headers = {
      authorization: 'Bearer ' + token,
      accept: 'application/json',
      'content-type': 'application/json',
    };
    if (sid) headers['x-server-id'] = sid;
  `;
}

// Emits JS that declares and sets `channelId` from a channel input that is
// either a UUID (passthrough) or a "#name"/"name" (case-insensitive lookup
// against GET /channels/). Requires `headers` from authHeadersFragment. On a
// miss it `return`s { kind: 'unresolvable' }.
export function channelResolveFragment(channelInput) {
  const raw = String(channelInput ?? '');
  const isUuid = UUID_RE.test(raw);
  const rawJson = JSON.stringify(raw);
  const nameJson = JSON.stringify(raw.replace(/^#/, '').toLowerCase());
  return `
    let channelId;
    if (${isUuid}) {
      channelId = ${rawJson};
    } else {
      const cres = await fetch('/api/channels/', { credentials: 'include', headers });
      if (cres.status === 401) return { kind: 'auth', detail: '/channels/ returned 401' };
      if (!cres.ok) return { kind: 'http', status: cres.status, where: '/channels/' };
      const carr = await cres.json();
      const clist = Array.isArray(carr) ? carr : (carr.channels || carr.data || []);
      const chit = clist.find((c) => (c.name || c.slug || '').toLowerCase() === ${nameJson});
      if (!chit) return { kind: 'unresolvable', detail: 'no channel matches ' + ${nameJson} };
      channelId = chit.id;
    }
  `;
}

// opts: { method, path, body?, serverScoped, serverIdOverride? }
//   method      'GET' | 'POST' | 'DELETE' | 'PATCH'
//   serverScoped  when true, resolve slug→id and send X-Server-Id
//   serverIdOverride  if set, skip the localStorage slug lookup for this call
// Single fetch to a fixed path. Use buildChannelScopedSnippet when the path
// depends on a channel that must first be resolved from a name.
export function buildFetchSnippet(opts) {
  const method = JSON.stringify(opts.method);
  const path = JSON.stringify('/api' + opts.path);
  const bodyJson = opts.body === undefined ? 'undefined' : JSON.stringify(JSON.stringify(opts.body));
  return `
    ${authHeadersFragment({ serverScoped: opts.serverScoped, serverIdOverride: opts.serverIdOverride })}
    const res = await fetch(${path}, {
      method: ${method}, credentials: 'include', headers,
      body: ${bodyJson},
    });
    if (res.status === 401) return { kind: 'auth', detail: ${path} + ' returned 401' };
    if (!res.ok) return { kind: 'http', status: res.status, where: ${path} };
    const data = await res.json().catch(() => ({}));
    return { kind: 'ok', rows: data };
  `;
}

// opts: { channelInput, method, pathSuffix?, body?, query?, serverIdOverride? }
// Resolves channelInput (uuid or #name) then fetches /channels/:id<pathSuffix><query>.
// Always server-scoped. `query` (if given) must include its leading '?'.
export function buildChannelScopedSnippet(opts) {
  const method = JSON.stringify(opts.method);
  const suffix = JSON.stringify(opts.pathSuffix || '');
  const query = opts.query ? JSON.stringify(opts.query) : "''";
  const bodyJson = opts.body === undefined ? 'undefined' : JSON.stringify(JSON.stringify(opts.body));
  return `
    ${authHeadersFragment({ serverScoped: true, serverIdOverride: opts.serverIdOverride })}
    ${channelResolveFragment(opts.channelInput)}
    const __url = '/api/channels/' + encodeURIComponent(channelId) + ${suffix} + ${query};
    const res = await fetch(__url, { method: ${method}, credentials: 'include', headers, body: ${bodyJson} });
    if (res.status === 401) return { kind: 'auth', detail: __url + ' returned 401' };
    if (!res.ok) return { kind: 'http', status: res.status, where: __url };
    const data = await res.json().catch(() => ({}));
    return { kind: 'ok', rows: data };
  `;
}
