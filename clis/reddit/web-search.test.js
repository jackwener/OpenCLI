import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { getRegistry } from '@jackwener/opencli/registry';
import './search.js';
const doms = [];
afterEach(() => { for (const dom of doms.splice(0)) dom.window.close(); });
const unit = (id, extra = '') => `<div data-testid="search-post-unit"><search-telemetry-tracker data-faceplate-tracking-context='{"post":{"id":"t3_${id}"}}'></search-telemetry-tracker>${extra}</div>`;
const row = id => ({ kind: 't3', data: { id, name: `t3_${id}`, title: `Post ${id}`, permalink: `/r/test/comments/${id}/post/`, selftext: 'body', score: 3 } });
const listing = ids => JSON.stringify({ data: { children: ids.map(row) } });
const partial = src => `<faceplate-partial src="${src.replaceAll('&', '&amp;')}"></faceplate-partial>`;
function fixture(responses) {
  const dom = new JSDOM('', { url: 'https://www.reddit.com', runScripts: 'outside-only' }); doms.push(dom);
  const fetch = vi.fn(async path => {
    const next = responses.shift(); if (!next) throw new Error('Unexpected extra request');
    return { ok: (next.status || 200) < 400, status: next.status || 200, url: next.url || new URL(path, 'https://www.reddit.com').href,
      headers: { get: () => next.type || 'text/html' }, text: async () => next.body };
  });
  dom.window.fetch = fetch;
  const page = { goto: vi.fn(), evaluate: vi.fn(async script => dom.window.eval(script)) };
  const run = args => getRegistry().get('reddit/search').func(page, { query: 'Note 7 recall China', limit: 5, ...args });
  return { dom, fetch, page, run };
}
describe('Reddit ranked web search', () => {
  it('preserves web order across pagination and unordered hydration, deduplicating trackers and posts', async () => {
    const f = fixture([
      { body: unit('a', unit('a').match(/<search-telemetry[\s\S]*<\/search-telemetry-tracker>/)[0]) + unit('b') + partial('/svc/shreddit/search?cursor=next') },
      { body: unit('b') + unit('c') },
      { body: listing(['c', 'a', 'b']), type: 'application/json' },
    ]);
    const results = await f.run({ limit: 3, subreddit: 'Android', sort: 'new', time: 'week' });
    expect(results.map(r => r.id)).toEqual(['a', 'b', 'c']);
    expect(results.every(r => r.selftext === 'body')).toBe(true);
    const first = new URL(f.fetch.mock.calls[0][0], 'https://www.reddit.com');
    expect(first.pathname).toBe('/r/Android/search/');
    expect(Object.fromEntries(first.searchParams)).toMatchObject({ q: 'Note 7 recall China', sort: 'new', t: 'week', restrict_sr: '1', type: 'posts' });
    expect(f.fetch.mock.calls[2][0]).toContain('/by_id/t3_a,t3_b,t3_c.json');
  });
  it('falls back only for initial unsupported markup', async () => {
    const f = fixture([{ body: '<main>New search layout</main>' }, { body: listing(['a']), type: 'application/json' }]);
    expect((await f.run()).map(r => r.id)).toEqual(['a']);
    expect(f.fetch.mock.calls[1][0]).toContain('/search.json?');
  });
  it('returns an explicit empty result without legacy ranking', async () => {
    const f = fixture([{ body: '<main>No results found</main>' }]);
    expect(await f.run()).toEqual([]); expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    { status: 429, body: '<html>Rate limited</html>' },
    { status: 403, body: '<html>Access denied</html>' },
    { body: '<title>Log in - Reddit</title>' },
    { body: '<main>You have been blocked by network security</main>' },
    { body: '<form action="/login"></form>' },
    { body: '<html>Login</html>', url: 'https://www.reddit.com/login/' },
  ])('never falls back after a blocked web response: %j', async response => {
    const f = fixture([response]); await expect(f.run()).rejects.toThrow(); expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it('reports Reddit\'s network-security block on /by_id hydration as SECURITY_BLOCK, not LOGIN_WALL (#2720)', async () => {
    const f = fixture([{ body: unit('a') }, { status: 403, body: '<body class=theme-beta><p>You\'ve been blocked by network security.</p></body>' }]);
    await expect(f.run()).rejects.toMatchObject({ code: 'SECURITY_BLOCK', message: expect.stringContaining('/by_id post hydration') });
    expect(f.fetch).toHaveBeenCalledTimes(2);
  });
  it('reports a network-security block on the web search page as SECURITY_BLOCK without falling back', async () => {
    const f = fixture([{ status: 403, body: '<body class=theme-beta><p>You\'ve been blocked by network security.</p></body>' }]);
    await expect(f.run()).rejects.toMatchObject({ code: 'SECURITY_BLOCK' }); expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it('does not mistake a result discussing a network block for a challenge', async () => {
    const f = fixture([{ body: unit('a') + '<title>Log in - Reddit search</title><form action="/login" hidden></form><p>I have been blocked by network security</p>' }, { body: listing(['a']), type: 'application/json' }]);
    expect((await f.run()).map(r => r.id)).toEqual(['a']);
  });
  it.each([
    '/svc/shreddit/search?cursor=next&q=other',
    'https://attacker.invalid/svc/shreddit/search?cursor=next',
    'https://user:password@www.reddit.com/svc/shreddit/search?cursor=next',
  ])('rejects unsafe or mismatched next-page URLs: %s', async src => {
    const f = fixture([{ body: unit('a') + partial(src) }]);
    await expect(f.run()).rejects.toThrow(/pagination/); expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it('stops on a repeated cursor without re-fetching the same page', async () => {
    const next = partial('/svc/shreddit/search?cursor=next');
    const f = fixture([{ body: unit('a') + next }, { body: unit('b') + next }]);
    await expect(f.run()).rejects.toThrow(/repeated/); expect(f.fetch).toHaveBeenCalledTimes(2);
  });
  it('stops on a rate limit during pagination instead of returning partial data or falling back', async () => {
    const f = fixture([{ body: unit('a') + partial('/svc/shreddit/search?cursor=next') }, { status: 429, body: 'slow down' }]);
    await expect(f.run()).rejects.toThrow(/429/); expect(f.fetch).toHaveBeenCalledTimes(2);
  });
  it('stops on HTML rate limiting during hydration', async () => {
    const f = fixture([{ body: unit('a') }, { status: 429, body: '<html>slow down</html>' }]);
    await expect(f.run()).rejects.toThrow(/429/); expect(f.fetch).toHaveBeenCalledTimes(2);
  });
  it('does not report successful empty output when all hydration rows are missing', async () => {
    const f = fixture([{ body: unit('a') }, { body: listing([]), type: 'application/json' }]);
    await expect(f.run()).rejects.toThrow(/hydrated/);
  });
  it('retains the rank of available posts when a deleted post cannot be hydrated', async () => {
    const f = fixture([{ body: unit('a') + unit('b') + unit('c') }, { body: listing(['c', 'a']), type: 'application/json' }]);
    expect((await f.run()).map(r => r.id)).toEqual(['a', 'c']);
  });
  it('rejects mismatched hydrated identities', async () => {
    const bad = row('b'); bad.data.name = 't3_a';
    const f = fixture([{ body: unit('a') }, { body: JSON.stringify({ data: { children: [bad] } }), type: 'application/json' }]);
    await expect(f.run()).rejects.toThrow(/identity/);
  });
  it('rejects ambiguous post identity inside one result unit', async () => {
    const f = fixture([{ body: unit('a', unit('b')) }]);
    await expect(f.run()).rejects.toThrow(/identity/); expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it('bounds the requested result count before navigating', async () => {
    const f = fixture([]); await expect(f.run({ limit: 1000000 })).rejects.toMatchObject({ code: 'ARGUMENT' });
    expect(f.page.goto).not.toHaveBeenCalled();
  });
  it('hydrates in batches of at most 100 and preserves all ranked IDs', async () => {
    const ids = Array.from({ length: 105 }, (_, i) => i.toString(36));
    const f = fixture([{ body: ids.map(id => unit(id)).join('') },
      { body: listing(ids.slice(0, 100).reverse()), type: 'application/json' },
      { body: listing(ids.slice(100).reverse()), type: 'application/json' }]);
    expect((await f.run({ limit: 105 })).map(r => r.id)).toEqual(ids);
    expect(f.fetch).toHaveBeenCalledTimes(3);
    expect(f.fetch.mock.calls[1][0].split(',')).toHaveLength(100);
  });
  it('caps web pagination at ten pages', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => i.toString(36));
    const responses = ids.map((id, i) => ({ body: unit(id) + partial('/svc/shreddit/search?cursor=' + (i + 1)) }));
    responses.push({ body: listing(ids), type: 'application/json' });
    const f = fixture(responses);
    expect((await f.run({ limit: 20 })).map(r => r.id)).toEqual(ids);
    expect(f.fetch).toHaveBeenCalledTimes(11);
  });

});
