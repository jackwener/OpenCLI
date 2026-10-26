import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError, LoginWallError } from '@jackwener/opencli/errors';
import './hot.js';

const command = getRegistry().get('reddit/hot');
function browserPage({ status = 200, payload, text, contentType = 'application/json', error } = {}) {
  const fetch = error ? vi.fn().mockRejectedValue(error) : vi.fn().mockResolvedValue({
    status, ok: status >= 200 && status < 300,
    headers: { get: () => contentType },
    text: async () => text ?? JSON.stringify(payload),
  });
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn(source => new Function('fetch', `return ${source}`)(fetch)),
    fetch,
  };
}
const post = { data: {
  id: 'abc', title: 'A post', subreddit_name_prefixed: 'r/test', author: 'alice',
  score: 4, num_comments: 2, permalink: '/r/test/comments/abc/post/', post_hint: 'image',
  preview: { images: [{ source: { url: 'https://example.test/p&amp;1' } }] },
  gallery_data: { items: [{ media_id: 'm1' }] },
  media_metadata: { m1: { s: { u: 'https://example.test/g&amp;1' } } },
} };
const listing = children => ({ kind: 'Listing', data: { children } });

describe('reddit hot', () => {
  it.each([
    [{}, '/hot.json?limit=20&raw_json=1'],
    [{ subreddit: 'programming', limit: 2 }, '/r/programming/hot.json?limit=2&raw_json=1'],
    [{ subreddit: 'a/b', limit: 1 }, '/r/a%2Fb/hot.json?limit=1&raw_json=1'],
  ])('keeps the requested feed and credentials: %j', async (args, path) => {
    const page = browserPage({ payload: listing([post]) });
    const rows = await command.func(page, args);
    expect(page.fetch).toHaveBeenCalledExactlyOnceWith(path, { credentials: 'include' });
    expect(rows[0]).toMatchObject({ rank: 1, postId: 'abc', title: 'A post',
      preview_image_url: 'https://example.test/p&1', gallery_urls: ['https://example.test/g&1'] });
  });
  it('limits output and preserves ranks', async () => {
    const page = browserPage({ payload: listing([post, post]) });
    await expect(command.func(page, { limit: 1 })).resolves.toHaveLength(1);
  });
  it('classifies a legitimate empty listing without changing feeds', async () => {
    const page = browserPage({ payload: listing([]) });
    await expect(command.func(page, {})).rejects.toBeInstanceOf(EmptyResultError);
    expect(page.fetch).toHaveBeenCalledTimes(1);
  });
  it.each([null, {}, { data: { children: {} } }, listing([null])])('rejects malformed payloads: %j', async payload => {
    await expect(command.func(browserPage({ payload }), {})).rejects.toBeInstanceOf(CommandExecutionError);
  });
  it.each([401, 403])('classifies HTTP %i as authentication required', async status => {
    await expect(command.func(browserPage({ status, payload: {} }), {})).rejects.toBeInstanceOf(AuthRequiredError);
  });
  it.each([429, 500])('reports HTTP %i as a command error', async status => {
    const result = command.func(browserPage({ status, payload: {} }), {});
    await expect(result).rejects.toBeInstanceOf(CommandExecutionError);
    if (status === 429) await expect(result).rejects.toMatchObject({ hint: expect.stringContaining('Stop retrying') });
  });
  it('keeps an HTML rate limit out of the login-wall path', async () => {
    await expect(command.func(browserPage({ status: 429, text: '<html>Slow down', contentType: 'text/html' }), {}))
      .rejects.toMatchObject({ constructor: CommandExecutionError, hint: expect.stringContaining('Stop retrying') });
  });
  it('classifies login HTML and invalid JSON', async () => {
    await expect(command.func(browserPage({ status: 403, text: '<html>Log in', contentType: 'text/html' }), {}))
      .rejects.toBeInstanceOf(LoginWallError);
    await expect(command.func(browserPage({ text: 'invalid JSON' }), {})).rejects.toBeInstanceOf(CommandExecutionError);
  });
  it('classifies fetch failures', async () => {
    await expect(command.func(browserPage({ error: new Error('offline') }), {}))
      .rejects.toMatchObject({ constructor: CommandExecutionError, message: expect.stringContaining('offline') });
  });
  it('unwraps browser session envelopes', async () => {
    const page = { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue({ session: 's', data: { kind: 'ok', rows: [post] } }) };
    await expect(command.func(page, {})).resolves.toHaveLength(1);
  });
  it.each([0, -1, 1.5, 101, 'bad'])('rejects invalid limits before navigating: %s', async limit => {
    const page = browserPage();
    await expect(command.func(page, { limit })).rejects.toBeInstanceOf(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });
});
