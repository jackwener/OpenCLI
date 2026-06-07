import { describe, it, expect, vi } from 'vitest';
import { buildFetchSnippet } from './in-page.js';

// Run a snippet in this realm with fetch + localStorage stubbed.
// async + awaited inside try/finally so globals are restored only AFTER
// the snippet's async IIFE fully settles.
async function runSnippet(snippet, fetchImpl, lsMap = {}) {
  const realFetch = globalThis.fetch;
  const realLS = globalThis.localStorage;
  const store = { ...lsMap };
  globalThis.fetch = fetchImpl;
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
  try {
    // eslint-disable-next-line no-eval
    return await eval(`(async () => { ${snippet} })()`);
  } finally {
    globalThis.fetch = realFetch;
    globalThis.localStorage = realLS;
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
    expect(call[0]).toBe('/api/messages');
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
