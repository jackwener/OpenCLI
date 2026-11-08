import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { getRegistry } from '@jackwener/opencli/registry';
import './subreddit.js';
import './search.js';

// Body Reddit serves for blocked .json requests (#2720, #2771).
const BLOCKED = '<body class=theme-beta><div><p>You\'ve been blocked by network security.</p></div></body>';
const doms = [];
afterEach(() => { for (const dom of doms.splice(0)) dom.window.close(); });

function fixture(responses) {
  const dom = new JSDOM('', { url: 'https://www.reddit.com', runScripts: 'outside-only' }); doms.push(dom);
  const fetch = vi.fn(async path => {
    const next = responses.shift(); if (!next) throw new Error(`Unexpected extra request: ${path}`);
    return { ok: (next.status || 200) < 400, status: next.status || 200, url: next.url || new URL(path, 'https://www.reddit.com').href,
      headers: { get: () => next.type || 'text/html' }, text: async () => next.body };
  });
  dom.window.fetch = fetch;
  return { fetch, page: { goto: vi.fn(), evaluate: vi.fn(async script => dom.window.eval(script)) } };
}

const attrs = o => Object.entries(o).map(([k, v]) => `${k}="${String(v).replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`).join(' ');
const post = (id, extra = {}, body = '') => `<shreddit-post ${attrs({
  id: `t3_${id}`, 'post-title': `Post ${id}`, 'subreddit-prefixed-name': 'r/pics', author: 'alice', score: 12, 'comment-count': 3,
  permalink: `/r/pics/comments/${id}/post_${id}/`, 'created-timestamp': '2026-11-07T20:13:02.794000+0000', 'post-type': 'text',
  'content-href': `https://www.reddit.com/r/pics/comments/${id}/post_${id}/`, ...extra,
})}>${body}</shreddit-post>`;
const ad = '<shreddit-ad-post id="t3_ad1" post-title="Buy now"></shreddit-ad-post>';
const more = src => `<faceplate-partial src="${src.replaceAll('&', '&amp;')}"></faceplate-partial>`;

describe('reddit/subreddit HTML feed fallback', () => {
  const run = (f, args) => getRegistry().get('reddit/subreddit').func(f.page, { name: 'pics', ...args });

  it('reads the server-rendered feed when the .json listing is blocked, skipping ads and following the cursor', async () => {
    const f = fixture([
      { status: 403, body: BLOCKED },
      { body: post('a', {}, '<div slot="text-body"><p>Hello   \n</p><p>world</p></div>') + ad
          + post('b', { 'post-type': 'link', 'content-href': 'https://example.test/x?a=1&b=2' })
          + more('/svc/shreddit/community-more-posts/top/?name=pics&t=WEEK&after=dDNfYg%3D%3D') },
      { body: post('b') + post('c', { 'post-type': 'image', 'content-href': 'https://i.redd.it/c.png' }) },
    ]);
    const rows = await run(f, { sort: 'top', time: 'week', limit: 3 });
    expect(f.fetch.mock.calls[0][0]).toBe('/r/pics/top.json?limit=3&raw_json=1&t=week');
    expect(f.fetch.mock.calls[1][0]).toBe('/svc/shreddit/community-more-posts/top/?name=pics&t=week');
    expect(f.fetch.mock.calls[2][0]).toBe('/svc/shreddit/community-more-posts/top/?name=pics&t=WEEK&after=dDNfYg%3D%3D');
    expect(rows.map(r => r.id)).toEqual(['a', 'b', 'c']);
    expect(rows[0]).toMatchObject({
      title: 'Post a', subreddit: 'r/pics', author: 'alice', upvotes: 12, comments: 3,
      url: 'https://www.reddit.com/r/pics/comments/a/post_a/', created_utc: 1794082382.794,
      post_hint: 'self', url_overridden_by_dest: '', gallery_urls: [],
    });
    expect(rows[0].selftext).toContain('Hello');
    expect(rows[0].selftext).toContain('world');
    expect(rows[1]).toMatchObject({ post_hint: 'link', url_overridden_by_dest: 'https://example.test/x?a=1&b=2', selftext: '' });
    expect(rows[2]).toMatchObject({ post_hint: 'image', url_overridden_by_dest: 'https://i.redd.it/c.png' });
  });

  it('leaves url_overridden_by_dest empty when content-href is the post itself', async () => {
    const f = fixture([{ status: 403, body: BLOCKED }, { body: post('m', { 'post-type': 'multi_media' }) }]);
    expect((await run(f, { limit: 1 }))[0]).toMatchObject({ id: 'm', post_hint: '', url_overridden_by_dest: '' });
  });

  it('does not use the feed when the .json listing works', async () => {
    const f = fixture([{ type: 'application/json', body: JSON.stringify({ data: { children: [{ data: { id: 'a', title: 'A', permalink: '/r/pics/comments/a/' } }] } }) }]);
    expect((await run(f, { limit: 5 })).map(r => r.id)).toEqual(['a']);
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['rate limit', { status: 429, body: '<html>Too Many Requests</html>' }],
    ['login wall', { body: '<html><title>Log in</title></html>' }],
  ])('keeps a %s on the .json listing terminal without trying the feed', async (_, response) => {
    const f = fixture([response]);
    await expect(run(f, { limit: 5 })).rejects.toThrow();
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });

  it('reports SECURITY_BLOCK when the feed is blocked too', async () => {
    const f = fixture([{ status: 403, body: BLOCKED }, { status: 403, body: BLOCKED }]);
    await expect(run(f, { limit: 5 })).rejects.toMatchObject({ code: 'SECURITY_BLOCK', message: expect.stringContaining('HTML feed fallback') });
    expect(f.fetch).toHaveBeenCalledTimes(2);
  });

  it('reports a login wall in the feed as LOGIN_WALL', async () => {
    const f = fixture([{ status: 403, body: BLOCKED }, { body: '<html><title>Log in - Reddit</title><form action="/login"></form></html>' }]);
    await expect(run(f, { limit: 5 })).rejects.toMatchObject({ code: 'LOGIN_WALL' });
  });

  it.each([
    'https://attacker.invalid/svc/shreddit/community-more-posts/hot/?name=pics&after=x',
    'https://user:pw@www.reddit.com/svc/shreddit/community-more-posts/hot/?name=pics&after=x',
  ])('rejects an unsafe feed cursor: %s', async src => {
    const f = fixture([{ status: 403, body: BLOCKED }, { body: post('a') + more(src) }]);
    await expect(run(f, { limit: 5 })).rejects.toThrow(/unsafe pagination/);
    expect(f.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('reddit/search card fallback when /by_id hydration is blocked', () => {
  const tracking = (id, title) => JSON.stringify({ post: { id: `t3_${id}`, title }, profile: { name: 'bob' }, subreddit: { name: 'ClaudeCode' } }).replaceAll("'", '&#39;');
  const card = (id, title = `Card ${id}`) => `<div data-testid="search-post-unit">
    <search-telemetry-tracker data-faceplate-tracking-context='${tracking(id, title)}'>
      <a href="/r/ClaudeCode/comments/${id}/card_${id}/">${title}</a>
    </search-telemetry-tracker>
    <faceplate-timeago ts="2026-11-07T09:46:23.564000+0000"></faceplate-timeago>
    <span><faceplate-number number="3116"></faceplate-number> votes</span>
    <span><faceplate-number number="869"></faceplate-number> comments</span>
  </div>`;
  const run = (f, args) => getRegistry().get('reddit/search').func(f.page, { query: 'claude code', limit: 2, ...args });

  it('returns the fields shown on each result card, in web order', async () => {
    const f = fixture([{ body: card('b') + card('a') }, { status: 403, body: BLOCKED }]);
    const rows = await run(f);
    expect(rows).toEqual([
      expect.objectContaining({ id: 'b', title: 'Card b', subreddit: 'r/ClaudeCode', author: 'bob', score: 3116, comments: 869,
        url: 'https://www.reddit.com/r/ClaudeCode/comments/b/card_b/', created_utc: 1794044783.564, selftext: '' }),
      expect.objectContaining({ id: 'a', url: 'https://www.reddit.com/r/ClaudeCode/comments/a/card_a/' }),
    ]);
    expect(f.fetch).toHaveBeenCalledTimes(2);
  });

  it('reads the newer sdui-post-unit result layout the same way', async () => {
    const f = fixture([{ body: card('s').replace('data-testid="search-post-unit"', 'data-testid="sdui-post-unit"') }, { status: 403, body: BLOCKED }]);
    expect((await run(f, { limit: 1 }))[0]).toMatchObject({ id: 's', title: 'Card s', score: 3116, comments: 869 });
    expect(f.fetch).toHaveBeenCalledTimes(2);
  });

  it('still uses /by_id details when hydration works', async () => {
    const hydrated = { data: { children: [{ kind: 't3', data: { id: 'a', name: 't3_a', title: 'Full a', permalink: '/r/x/comments/a/', selftext: 'body' } }] } };
    const f = fixture([{ body: card('a') }, { type: 'application/json', body: JSON.stringify(hydrated) }]);
    expect((await run(f, { limit: 1 }))[0]).toMatchObject({ title: 'Full a', selftext: 'body' });
  });
});
