import { UUID_RE } from './resolve.js';
import { SLOCK_API_BASE } from './shared.js';

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
  // R1 — `--server <slug>` was being passed raw as X-Server-Id. The server
  // only accepts UUIDs, so a slug override returned 500 from /channels/ and
  // friends. Now: a UUID override is used directly; a slug override is
  // resolved against /servers/ the same way the active-slug path does
  // (single source of truth for slug→id). If neither override nor
  // active-slug yields a known server, we fail loud with `no-server`.
  // Source-verified (Bugen): /servers/ returns rows of { id, slug, name }.
  const overrideStr = serverIdOverride ? JSON.stringify(serverIdOverride) : 'null';
  const UUID_RE_SRC = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  const resolveServer = serverScoped
    ? `
    if (!sid) {
      // Determine the slug to look up: override slug (if not a UUID) wins,
      // otherwise fall back to the active slug from localStorage.
      const __override = ${overrideStr};
      const __slug = __override ?? localStorage.getItem('slock_last_server_slug');
      if (!__slug) return { kind: 'no-server', detail: 'no --server override and localStorage.slock_last_server_slug is empty; run \`slock server-use <slug>\` or pass --server <slug>' };
      const sres = await fetch('${SLOCK_API_BASE}/servers/', {
        method: 'GET', credentials: 'include',
        headers: { authorization: 'Bearer ' + token, accept: 'application/json' },
      });
      if (sres.status === 401) return { kind: 'auth', detail: '/servers/ returned 401' };
      if (!sres.ok) return { kind: 'http', status: sres.status, where: '/servers/' };
      const slist = await sres.json();
      const __arr = Array.isArray(slist) ? slist : [];
      const sm = __arr.find((s) => s && s.slug === __slug);
      if (!sm) {
        const __choices = __arr.map((s) => s && s.slug).filter(Boolean).join(', ');
        return { kind: 'no-server', detail: 'slug "' + __slug + '" not in /servers/' + (__override ? ' (--server)' : ' (active)') + '. Known slugs: ' + __choices };
      }
      sid = sm.id;
    }`
    : '';
  // Node-side gate: if the override looks like a UUID, set sid directly and
  // skip the lookup. Otherwise emit `let sid = null;` so the resolveServer
  // block runs and treats the override (or active slug) uniformly.
  const isUuidOverride = !!serverIdOverride && new RegExp(UUID_RE_SRC).test(String(serverIdOverride));
  const sidInit = isUuidOverride ? overrideStr : 'null';
  return `
    // Page-readiness loop: page.goto can return before the SPA's first navigation
    // settles, leaving location on an opaque interstitial (about:blank, redirector,
    // etc.). Reading localStorage there throws SecurityError "Access is denied".
    // Worse, qatester also live-flagged silent-empty fetches when the SPA had
    // navigated to app.slock.ai but had not yet hydrated the token into
    // localStorage — fetches then went out with an empty Authorization and the
    // server happily returned [].
    //
    // The loop polls BOTH: (a) location.href is on app.slock.ai (so localStorage
    // is no longer opaque) and (b) localStorage.slock_access_token is present
    // (so the SPA finished hydrating). Reading localStorage inside try/catch
    // because (a) and (b) can be partially satisfied — reading localStorage on
    // an opaque origin still throws even after a redirect starts.
    //
    // 3s ceiling so a real navigation failure fails loud instead of hanging.
    let __waited = 0;
    let __reason = 'never reached app.slock.ai';
    while (true) {
      let __onHost = false;
      try { __onHost = location.href.indexOf('app.slock.ai') !== -1; } catch (e) {}
      if (__onHost) {
        try {
          if (localStorage.getItem('slock_access_token')) break;
          __reason = 'on app.slock.ai but localStorage.slock_access_token not yet hydrated';
        } catch (e) {
          __reason = 'localStorage access threw even on app.slock.ai: ' + (e && e.message);
        }
      }
      if (__waited >= 3000) {
        let __loc;
        try { __loc = location.href; } catch (e) { __loc = '(unreadable)'; }
        return { kind: 'http', status: 0, where: 'page-readiness timeout: waited 3000ms (' + __reason + '), location=' + __loc };
      }
      await new Promise((r) => setTimeout(r, 50));
      __waited += 50;
    }
    const token = localStorage.getItem('slock_access_token');
    if (!token) return { kind: 'auth', detail: 'no access token in localStorage' };
    let sid = ${sidInit};${resolveServer}
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
      const cres = await fetch('${SLOCK_API_BASE}/channels/', { credentials: 'include', headers });
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

// Emits JS that expands a "#channel:shortId" short message id into the full
// messageId UUID via GET /api/messages/context/:shortId?channelId=<id>.
//
// Phase 7.1 invariant (kept across rewrites): read `cxd.targetMessageId`,
// NOT `m.message.id`. The latter is the closest-message-in-context object,
// which can be a neighbor when the short id is just a prefix — Phase 7.1
// bug class. Also: 404 from /messages/context means short id not found
// in that channel — caller should map it to `unresolvable`, distinct from
// other 404s in surrounding logic (threads-404 / channel-404 mean
// different things).
//
// `shortIdVar` is mutated in-place: on success it holds the resolved UUID.
//
// opts:
//   shortIdVar          name of the JS variable holding the short id (mutated)
//   parentChannelIdVar  name of the JS variable holding the parent channelId
//   contextDescription  optional `JSON.stringify`'d JS expression that
//                       evaluates to a string used in the "not found" detail
//                       (e.g. `"#general"` becomes `' in #' + 'general'`).
//                       Pass `"''"` to omit the suffix entirely.
//
// Drift-guarded by clis/slock/short-id-canary.test.js — any other file that
// hand-rolls `cxd.targetMessageId` short-id resolution fails the canary.
export function resolveShortIdFragment({ shortIdVar, parentChannelIdVar, contextDescription = "''" }) {
  return `
    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(${shortIdVar})) {
      const cx = await fetch('${SLOCK_API_BASE}/messages/context/' + encodeURIComponent(${shortIdVar}) + '?channelId=' + encodeURIComponent(${parentChannelIdVar}), { credentials:'include', headers });
      if (cx.status === 404) {
        const __ctx = ${contextDescription};
        return { kind: 'unresolvable', detail: 'short id "' + ${shortIdVar} + '" not found' + (__ctx ? ' in #' + __ctx : '') };
      }
      if (!cx.ok) return { kind: cx.status===401?'auth':'http', status: cx.status, where:'/messages/context' };
      const cxd = await cx.json();
      // CRITICAL — read targetMessageId, NOT m.message.id (Phase 7.1).
      ${shortIdVar} = cxd.targetMessageId;
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
  const path = JSON.stringify(SLOCK_API_BASE + opts.path);
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
    const __url = '${SLOCK_API_BASE}/channels/' + encodeURIComponent(channelId) + ${suffix} + ${query};
    const res = await fetch(__url, { method: ${method}, credentials: 'include', headers, body: ${bodyJson} });
    if (res.status === 401) return { kind: 'auth', detail: __url + ' returned 401' };
    if (!res.ok) return { kind: 'http', status: res.status, where: __url };
    const data = await res.json().catch(() => ({}));
    return { kind: 'ok', rows: data };
  `;
}
