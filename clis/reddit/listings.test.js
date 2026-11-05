import { createContext, runInContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import './hot.js';
import './frontpage.js';
import './popular.js';
import './subreddit.js';
import './user.js';
import './user-posts.js';
import './user-comments.js';
import './saved.js';
import './upvoted.js';

// Body Reddit served for blocked .json requests in #2720 / #2771.
const NETWORK_SECURITY_PAGE = '<body class=theme-beta><div><p>You\'ve been blocked by network security.</p>'
  + '<p>To continue, log in to your Reddit account or use your developer token</p></div></body>';

function response(body, { status = 200, type = 'application/json; charset=UTF-8' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: '',
    headers: { get: name => (name.toLowerCase() === 'content-type' ? type : null) },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function runtimePage(fetch) {
  const context = createContext({ fetch });
  return { goto: vi.fn(), evaluate: async code => runInContext(code, context) };
}

const post = { id: 'abc', title: 'Photo', subreddit_name_prefixed: 'r/pics', author: 'Alice', score: 12,
  num_comments: 3, permalink: '/r/pics/comments/abc', post_hint: 'image', url_overridden_by_dest: 'https://img.test/main',
  preview: { images: [{ source: { url: 'https://img.test/preview?a=1&amp;b=2' } }] },
  gallery_data: { items: [{ media_id: 'one' }] }, media_metadata: { one: { s: { u: 'https://img.test/gallery?a=1&amp;b=2' } } },
};

it.each([
  ['hot', { subreddit: 'pics' }, '/r/pics/hot.json?limit=1&raw_json=1'],
  ['frontpage', {}, '/r/all.json?limit=1&raw_json=1'],
  ['popular', {}, '/r/popular.json?limit=1&raw_json=1'],
  ['subreddit', { name: 'r/pics', sort: 'top', time: 'week' }, '/r/pics/top.json?limit=1&raw_json=1&t=week'],
])('reddit/%s maps its listing and preserves media arrays', async (name, args, url) => {
  const fetch = vi.fn().mockResolvedValue(response({ data: { children: [{ data: post }, { data: post }] } }));
  const rows = await getRegistry().get(`reddit/${name}`).func(runtimePage(fetch), { ...args, limit: 1 });
  expect(fetch).toHaveBeenCalledWith(url, { credentials: 'include' });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ title: 'Photo', author: 'Alice', comments: 3,
    post_hint: 'image', url_overridden_by_dest: 'https://img.test/main',
    preview_image_url: 'https://img.test/preview?a=1&b=2', gallery_urls: ['https://img.test/gallery?a=1&b=2'],
  });
});

describe('reddit listing failures', () => {
  const commands = [
    ['hot', {}],
    ['frontpage', {}],
    ['popular', {}],
    ['subreddit', { name: 'pics', sort: 'new' }],
    ['user', { username: 'alice' }],
    ['user-posts', { username: 'alice' }],
    ['user-comments', { username: 'alice' }],
    ['saved', {}],
    ['upvoted', {}],
  ];

  it.each(commands)('reddit/%s reports the network-security page as SECURITY_BLOCK, not a JSON SyntaxError or login wall', async (name, args) => {
    const fetch = vi.fn().mockResolvedValue(response(NETWORK_SECURITY_PAGE, { status: 403, type: 'text/html' }));
    const error = await getRegistry().get(`reddit/${name}`).func(runtimePage(fetch), { ...args, limit: 5 }).catch(e => e);
    expect(error).toMatchObject({ code: 'SECURITY_BLOCK', hint: expect.stringContaining('not an expired login') });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reddit/subreddit reports a rate limit as RATE_LIMITED without retrying', async () => {
    const fetch = vi.fn().mockResolvedValue(response('<html>Too Many Requests</html>', { status: 429, type: 'text/html' }));
    await expect(getRegistry().get('reddit/subreddit').func(runtimePage(fetch), { name: 'pics', limit: 5 }))
      .rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reddit/subreddit keeps other HTML responses as LOGIN_WALL', async () => {
    const fetch = vi.fn().mockResolvedValue(response('<html><title>Log in</title></html>', { type: 'text/html' }));
    await expect(getRegistry().get('reddit/subreddit').func(runtimePage(fetch), { name: 'pics', limit: 5 }))
      .rejects.toMatchObject({ code: 'LOGIN_WALL' });
  });

  it('reddit/subreddit fails on a listing without data.children instead of returning no rows', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ kind: 'Listing', data: {} }));
    await expect(getRegistry().get('reddit/subreddit').func(runtimePage(fetch), { name: 'pics', limit: 5 }))
      .rejects.toBeInstanceOf(CommandExecutionError);
  });

  it('reddit/saved hydrates the username before fetching the saved listing', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ name: 'alice' }))
      .mockResolvedValueOnce(response({ data: { children: [{ data: post }] } }));
    const rows = await getRegistry().get('reddit/saved').func(runtimePage(fetch), { limit: 5 });
    expect(fetch.mock.calls.map(call => call[0])).toEqual(['/api/me.json?raw_json=1', '/user/alice/saved.json?limit=5&raw_json=1']);
    expect(rows).toEqual([{ title: 'Photo', subreddit: 'r/pics', score: 12, comments: 3, url: 'https://www.reddit.com/r/pics/comments/abc' }]);
  });
});
