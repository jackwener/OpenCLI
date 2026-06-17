import { describe, it, expect, vi } from 'vitest';
import { buildFetchSnippet, buildChannelScopedSnippet, channelResolveFragment } from './in-page.js';
import { SLOCK_API_BASE } from './shared.js';

const UUID_A = '11111111-1111-1111-1111-111111111111';

// Run a snippet in this realm with fetch + localStorage stubbed.
// async + awaited inside try/finally so globals are restored only AFTER
// the snippet's async IIFE fully settles.
async function runSnippet(snippet, fetchImpl, lsMap = {}) {
  const realFetch = globalThis.fetch;
  const realLS = globalThis.localStorage;
  const realLocation = globalThis.location;
  const store = { ...lsMap };
  globalThis.fetch = fetchImpl;
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
  // authHeadersFragment now opens with a page-readiness loop that waits until
  // location.href contains 'app.slock.ai' (so localStorage on an opaque
  // interstitial origin doesn't throw SecurityError). Stub a satisfied
  // location so the snippet doesn't burn 3s of fake time.
  globalThis.location = { href: 'https://app.slock.ai/' };
  try {
    // eslint-disable-next-line no-eval
    return await eval(`(async () => { ${snippet} })()`);
  } finally {
    globalThis.fetch = realFetch;
    globalThis.localStorage = realLS;
    globalThis.location = realLocation;
  }
}

describe('buildFetchSnippet', () => {
  it('GET with no body returns the ok envelope on 200', async () => {
    const snippet = buildFetchSnippet({ method: 'GET', path: '/channels/', serverScoped: true });
    const fakeFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 's1', slug: 'eng' }] })  // GET /servers/
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 'c1', name: 'general' }] });
    const result = await runSnippet(snippet, fakeFetch, {
      slock_access_token: 'tkn',
      slock_last_server_slug: 'eng',
    });
    expect(result).toEqual({ kind: 'ok', rows: [{ id: 'c1', name: 'general' }] });
  });

  it('POST sends the JSON body with content-type header', async () => {
    const snippet = buildFetchSnippet({
      method: 'POST',
      path: '/messages',
      body: { channelId: 'c1', content: 'hi' },
      serverScoped: true,
    });
    const fakeFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 's1', slug: 'eng' }] })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'm1' }) });
    await runSnippet(snippet, fakeFetch, {
      slock_access_token: 'tkn',
      slock_last_server_slug: 'eng',
    });
    const call = fakeFetch.mock.calls[1];
    expect(call[0]).toBe(SLOCK_API_BASE + '/messages');
    expect(call[1].method).toBe('POST');
    expect(call[1].headers['content-type']).toBe('application/json');
    expect(JSON.parse(call[1].body)).toEqual({ channelId: 'c1', content: 'hi' });
  });

  it('server-scoped path injects X-Server-Id from resolved slug', async () => {
    const snippet = buildFetchSnippet({ method: 'GET', path: '/channels/', serverScoped: true });
    const fakeFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 'sid-1', slug: 'eng' }] })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] });
    await runSnippet(snippet, fakeFetch, {
      slock_access_token: 'tkn',
      slock_last_server_slug: 'eng',
    });
    expect(fakeFetch.mock.calls[1][1].headers['x-server-id']).toBe('sid-1');
  });

  it('non-server-scoped path does NOT include X-Server-Id', async () => {
    const snippet = buildFetchSnippet({ method: 'GET', path: '/auth/me', serverScoped: false });
    const fakeFetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'u1' }) });
    await runSnippet(snippet, fakeFetch, { slock_access_token: 'tkn' });
    expect(fakeFetch.mock.calls[0][1].headers['x-server-id']).toBeUndefined();
  });

  it('returns kind:"auth" envelope on 401', async () => {
    const snippet = buildFetchSnippet({ method: 'GET', path: '/auth/me', serverScoped: false });
    const fakeFetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });
    const result = await runSnippet(snippet, fakeFetch, { slock_access_token: 'tkn' });
    expect(result).toMatchObject({ kind: 'auth' });
  });

  it('returns kind:"no-server" when localStorage slug is missing on a server-scoped call', async () => {
    const snippet = buildFetchSnippet({ method: 'GET', path: '/channels/', serverScoped: true });
    const fakeFetch = vi.fn();
    const result = await runSnippet(snippet, fakeFetch, { slock_access_token: 'tkn' });
    expect(result).toMatchObject({ kind: 'no-server' });
    expect(fakeFetch.mock.calls.length).toBe(0);
  });
});

// Red-line: body is always JSON.stringify'd — no string concatenation, so injection is impossible.
describe('buildFetchSnippet [red-line] injection safety', () => {
  for (const evil of [
    `'); alert('x'); ('`,
    `</script><script>1</script>`,
    `pizza 🍕 + surrogate 💊`,
  ]) {
    it(`content ${JSON.stringify(evil).slice(0, 40)}... round-trips byte-equal`, async () => {
      const snippet = buildFetchSnippet({
        method: 'POST',
        path: '/messages',
        body: { content: evil, channelId: 'c1' },
        serverScoped: true,
      });
      const fakeFetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 'sid', slug: 'eng' }] })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'm1' }) });
      await runSnippet(snippet, fakeFetch, {
        slock_access_token: 'tkn',
        slock_last_server_slug: 'eng',
      });
      const sentBody = JSON.parse(fakeFetch.mock.calls[1][1].body);
      expect(sentBody.content).toBe(evil);
    });
  }
});

describe('buildChannelScopedSnippet', () => {
  it('UUID channel + server override: single fetch straight to /channels/:id<suffix>', async () => {
    const snippet = buildChannelScopedSnippet({
      channelInput: UUID_A, method: 'GET', pathSuffix: '/members', serverIdOverride: '22222222-2222-2222-2222-222222222222',
    });
    const fakeFetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 'u1' }] });
    const result = await runSnippet(snippet, fakeFetch, { slock_access_token: 'tkn' });
    // No /servers/ resolve (override) and no /channels/ resolve (uuid) — one call.
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    expect(fakeFetch.mock.calls[0][0]).toBe(`${SLOCK_API_BASE}/channels/${UUID_A}/members`);
    expect(fakeFetch.mock.calls[0][1].headers['x-server-id']).toBe('22222222-2222-2222-2222-222222222222');
    expect(result).toEqual({ kind: 'ok', rows: [{ id: 'u1' }] });
  });

  it('#name channel: resolves slug→sid, then name→id, then hits the target', async () => {
    const snippet = buildChannelScopedSnippet({
      channelInput: '#general', method: 'POST', pathSuffix: '/read-all',
    });
    const fakeFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 'sid-1', slug: 'eng' }] })   // /servers/
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 'chan-7', name: 'general' }] }) // /channels/
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, seq: 42 }) });            // target
    const result = await runSnippet(snippet, fakeFetch, {
      slock_access_token: 'tkn', slock_last_server_slug: 'eng',
    });
    expect(fakeFetch.mock.calls[2][0]).toBe(SLOCK_API_BASE + '/channels/chan-7/read-all');
    expect(result).toEqual({ kind: 'ok', rows: { ok: true, seq: 42 } });
  });

  it('unresolvable channel name → kind:"unresolvable", no target fetch', async () => {
    const snippet = buildChannelScopedSnippet({
      channelInput: '#ghost', method: 'GET', serverIdOverride: '22222222-2222-2222-2222-222222222222',
    });
    const fakeFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 'chan-7', name: 'general' }] }); // /channels/
    const result = await runSnippet(snippet, fakeFetch, { slock_access_token: 'tkn' });
    expect(result).toMatchObject({ kind: 'unresolvable' });
    expect(fakeFetch).toHaveBeenCalledTimes(1); // only the resolve, no target
  });
});

describe('channelResolveFragment', () => {
  it('embeds the lowercased bare name (leading # stripped) as the lookup key', () => {
    const frag = channelResolveFragment('#General');
    // The name-lookup key is lowercased with the # stripped...
    expect(frag).toContain('=== "general"');
    // ...and never lowercases/strips into a different key.
    expect(frag).not.toContain('=== "#general"');
  });
});

describe('authHeadersFragment R1 — --server slug resolution', () => {
  // R1 — old behavior: `--server <slug>` was passed RAW as X-Server-Id, server
  // returned 500 because it only accepts UUIDs. Fix: resolve override slug
  // against /servers/ the same way active-slug does. UUID overrides bypass
  // the lookup (already an id).
  it('UUID override bypasses /servers/ lookup and goes straight to the target with x-server-id=<uuid>', async () => {
    const snippet = buildFetchSnippet({
      method: 'GET',
      path: '/channels/',
      serverScoped: true,
      serverIdOverride: '33333333-3333-3333-3333-333333333333',
    });
    const fakeFetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 'c1' }] });
    const result = await runSnippet(snippet, fakeFetch, { slock_access_token: 'tkn' });
    // Exactly one fetch — the target. No /servers/ resolve needed.
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    expect(fakeFetch.mock.calls[0][0]).toBe(SLOCK_API_BASE + '/channels/');
    expect(fakeFetch.mock.calls[0][1].headers['x-server-id']).toBe('33333333-3333-3333-3333-333333333333');
    expect(result.kind).toBe('ok');
  });

  it('[R1 critical] slug override resolves via /servers/ — NEVER sent raw as x-server-id', async () => {
    const snippet = buildFetchSnippet({
      method: 'GET',
      path: '/channels/',
      serverScoped: true,
      serverIdOverride: 'community',
    });
    const fakeFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [
        { id: 'sid-community-uuid', slug: 'community' },
        { id: 'sid-botiverse-uuid', slug: 'botiverse' },
      ] })  // /servers/ lookup
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 'c1' }] }); // target
    const result = await runSnippet(snippet, fakeFetch, {
      slock_access_token: 'tkn',
      slock_last_server_slug: 'botiverse',  // active is botiverse — override must win
    });
    // First call: /servers/ — resolving the override slug "community".
    expect(fakeFetch.mock.calls[0][0]).toBe(SLOCK_API_BASE + '/servers/');
    // Second call: target — with the RESOLVED sid, NOT the raw "community".
    expect(fakeFetch.mock.calls[1][0]).toBe(SLOCK_API_BASE + '/channels/');
    const sentSid = fakeFetch.mock.calls[1][1].headers['x-server-id'];
    expect(sentSid).toBe('sid-community-uuid');
    expect(sentSid).not.toBe('community'); // regression catch: raw slug must NEVER be sent
    expect(result.kind).toBe('ok');
  });

  it('[R1 critical] slug override wins over active slug in localStorage', async () => {
    // Whether user has done server-use, the override must steer.
    const snippet = buildFetchSnippet({
      method: 'GET', path: '/channels/', serverScoped: true, serverIdOverride: 'community',
    });
    const fakeFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [
        { id: 'sid-community-uuid', slug: 'community' },
        { id: 'sid-botiverse-uuid', slug: 'botiverse' },
      ] })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] });
    await runSnippet(snippet, fakeFetch, {
      slock_access_token: 'tkn',
      slock_last_server_slug: 'botiverse',
    });
    // It MUST have looked up 'community' (not 'botiverse'). Easiest check:
    // the resolved sid is the community one.
    expect(fakeFetch.mock.calls[1][1].headers['x-server-id']).toBe('sid-community-uuid');
  });

  it('slug override that does NOT exist in /servers/ fails loud with no-server + known slugs hint', async () => {
    const snippet = buildFetchSnippet({
      method: 'GET', path: '/channels/', serverScoped: true, serverIdOverride: 'no-such-slug',
    });
    const fakeFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: 's1', slug: 'community' }, { id: 's2', slug: 'botiverse' }] });
    const result = await runSnippet(snippet, fakeFetch, { slock_access_token: 'tkn' });
    expect(result.kind).toBe('no-server');
    expect(result.detail).toMatch(/no-such-slug/);
    expect(result.detail).toMatch(/--server/);
    expect(result.detail).toMatch(/community/);   // hint lists known slugs
    expect(fakeFetch).toHaveBeenCalledTimes(1);   // bailed before target fetch
  });

  it('with no override and no active-slug, fails loud with `no-server` mentioning server-use AND --server', async () => {
    const snippet = buildFetchSnippet({ method: 'GET', path: '/channels/', serverScoped: true });
    const fakeFetch = vi.fn();
    const result = await runSnippet(snippet, fakeFetch, { slock_access_token: 'tkn' });
    expect(result.kind).toBe('no-server');
    expect(result.detail).toMatch(/server-use/);
    expect(result.detail).toMatch(/--server/);
    expect(fakeFetch).not.toHaveBeenCalled();
  });
});

describe('authHeadersFragment page-readiness loop', () => {
  // qatester live-flagged a SecurityError on first command after page.goto:
  // page.goto returned before app.slock.ai actually loaded, leaving location
  // on an opaque interstitial — localStorage on opaque origin throws. The
  // fix is a polled wait inside authHeadersFragment for the SPA host. These
  // cases lock the wait shape so a future refactor can't quietly strip it.

  it('emits a polled wait that gates on BOTH location AND token-hydrated BEFORE the fetch', () => {
    const snippet = buildFetchSnippet({ method: 'GET', path: '/whoami', serverScoped: false });
    // (a) location.href check — guards SecurityError on opaque origins.
    expect(snippet).toContain("location.href.indexOf('app.slock.ai')");
    // (b) localStorage token check INSIDE the loop — guards silent-empty
    // (page is on app.slock.ai but SPA has not yet written the token, so
    // fetches went out with empty Authorization and server returned []).
    expect(snippet).toContain("localStorage.getItem('slock_access_token')");
    // The wait MUST sit before the final fetch; otherwise it doesn't
    // prevent the SecurityError. Pin order by index.
    const waitIdx = snippet.indexOf("location.href.indexOf('app.slock.ai')");
    const fetchIdx = snippet.indexOf('await fetch(');
    expect(waitIdx).toBeGreaterThan(-1);
    expect(fetchIdx).toBeGreaterThan(-1);
    expect(waitIdx).toBeLessThan(fetchIdx);
  });

  it('has a hard timeout that returns fail-loud kind:http rather than hanging', () => {
    const snippet = buildFetchSnippet({ method: 'GET', path: '/whoami', serverScoped: false });
    // Timeout ceiling pinned at 3000ms — change requires intentional bump.
    expect(snippet).toContain('3000');
    expect(snippet).toContain("'page-readiness timeout");
    // Must return a typed envelope (not throw / hang) so the CLI surfaces
    // a clean error.
    expect(snippet).toMatch(/return\s*\{\s*kind:\s*'http'/);
  });

  it('silent-empty guard: on app.slock.ai but token not yet hydrated → timeout fail-loud, never fetches', async () => {
    const snippet = buildFetchSnippet({ method: 'GET', path: '/whoami', serverScoped: false });
    const realFetch = globalThis.fetch;
    const realLS = globalThis.localStorage;
    const realLocation = globalThis.location;
    const realSetTimeout = globalThis.setTimeout;
    globalThis.fetch = vi.fn();
    // localStorage exists but slock_access_token never appears (the silent-empty
    // case qatester live-flagged: SPA hadn't hydrated yet).
    globalThis.localStorage = { getItem: () => null, setItem: () => {} };
    globalThis.location = { href: 'https://app.slock.ai/' };
    globalThis.setTimeout = (cb) => realSetTimeout(cb, 0);
    try {
      // eslint-disable-next-line no-eval
      const result = await eval(`(async () => { ${snippet} })()`);
      expect(result.kind).toBe('http');
      expect(result.where).toMatch(/not yet hydrated/);
      // Never fetched, because the loop never broke.
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = realFetch;
      globalThis.localStorage = realLS;
      globalThis.location = realLocation;
      globalThis.setTimeout = realSetTimeout;
    }
  });

  it('the wait actually triggers when location is NOT app.slock.ai (timeout path returns fail-loud)', async () => {
    const snippet = buildFetchSnippet({ method: 'GET', path: '/whoami', serverScoped: false });
    // Stub globals; location stays on a foreign origin so the loop will time out.
    const realFetch = globalThis.fetch;
    const realLS = globalThis.localStorage;
    const realLocation = globalThis.location;
    const realSetTimeout = globalThis.setTimeout;
    globalThis.fetch = vi.fn();
    globalThis.localStorage = { getItem: () => 'fake-token', setItem: () => {} };
    globalThis.location = { href: 'https://example.com/' };
    // Fast-forward setTimeout so the 3000ms loop completes instantly under test.
    globalThis.setTimeout = (cb) => realSetTimeout(cb, 0);
    try {
      // eslint-disable-next-line no-eval
      const result = await eval(`(async () => { ${snippet} })()`);
      expect(result.kind).toBe('http');
      expect(result.where).toMatch(/page-readiness timeout/);
      // fetch must NEVER have been called because we never got past the loop.
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = realFetch;
      globalThis.localStorage = realLS;
      globalThis.location = realLocation;
      globalThis.setTimeout = realSetTimeout;
    }
  });
});
