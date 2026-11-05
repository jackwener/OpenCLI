import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError, LoginWallError } from '@jackwener/opencli/errors';
import { __test__ } from './search.js';
import './search.js';

describe('reddit search adapter', () => {
  const command = getRegistry().get('reddit/search');

  function makePage(result) {
    return {
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(result),
    };
  }

  function makeBrowserResponsePage(response) {
    return {
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn((source) => new Function('fetch', `return ${source}`)(vi.fn().mockResolvedValue(response))),
    };
  }


  it('encodes search parameters without interpolating browser code', () => {
    expect(command?.func).toBeTypeOf('function');
    expect(__test__.buildRedditSearchPath({ query: 'agent harness', limit: 3 }))
      .toBe('/search.json?q=agent+harness&sort=relevance&t=all&limit=3&restrict_sr=off&raw_json=1');
  });

  it('maps a valid Reddit listing and keeps media fields', async () => {
    const page = makePage({
      kind: 'ok',
      rows: [{
        data: {
          id: 'abc',
          title: 'A post',
          subreddit_name_prefixed: 'r/test',
          author: 'alice',
          score: 4,
          num_comments: 2,
          permalink: '/r/test/comments/abc/a_post/',
          created_utc: 123,
          selftext: 'body',
          post_hint: 'image',
          url_overridden_by_dest: 'https://example.test/a&amp;b',
          preview: { images: [{ source: { url: 'https://example.test/p&amp;1' } }] },
          gallery_data: { items: [{ media_id: 'm1' }] },
          media_metadata: { m1: { s: { u: 'https://example.test/g&amp;1' } } },
        },
      }],
    });

    await expect(command.func(page, { query: 'agent harness', limit: 3 })).resolves.toEqual([{
      id: 'abc',
      title: 'A post',
      subreddit: 'r/test',
      author: 'alice',
      score: 4,
      comments: 2,
      url: 'https://www.reddit.com/r/test/comments/abc/a_post/',
      created_utc: 123,
      selftext: 'body',
      post_hint: 'image',
      url_overridden_by_dest: 'https://example.test/a&b',
      preview_image_url: 'https://example.test/p&1',
      gallery_urls: ['https://example.test/g&1'],
    }]);
    expect(page.goto).toHaveBeenCalledWith('https://www.reddit.com');
    expect(page.evaluate.mock.calls[0][0]).toContain('redditFetchJson');
  });

  it('preserves the requested output limit when the API returns extra rows', async () => {
    const page = makePage({
      kind: 'ok',
      rows: [
        { data: { id: 'first', title: 'First' } },
        { data: { id: 'second', title: 'Second' } },
      ],
    });
    await expect(command.func(page, { query: 'agent harness', limit: 1 }))
      .resolves.toHaveLength(1);
  });

  it('converts HTML login walls into LoginWallError', async () => {
    const page = makePage({
      kind: 'login-wall',
      sentinel: {
        __loginWall: true,
        status: 403,
        url: 'https://www.reddit.com/search.json',
        contentType: 'text/html',
        bodyPreview: '<html><title>Access denied</title>',
      },
    });
    await expect(command.func(page, { query: 'agent harness' })).rejects.toBeInstanceOf(LoginWallError);
  });

  it('executes the browser sniffer for an HTML 403 response', async () => {
    const page = makeBrowserResponsePage({
      status: 403,
      ok: false,
      url: 'https://www.reddit.com/search.json',
      headers: { get: () => 'text/html; charset=utf-8' },
      text: async () => '<html><title>Access denied</title>',
    });
    await expect(command.func(page, { query: 'agent harness' })).rejects.toBeInstanceOf(LoginWallError);
  });

  it('distinguishes auth, rate-limit, malformed, and browser failures', async () => {
    await expect(command.func(makePage({ kind: 'http', status: 403 }), { query: 'x' }))
      .rejects.toBeInstanceOf(AuthRequiredError);
    await expect(command.func(makePage({ kind: 'http', status: 429 }), { query: 'x' }))
      .rejects.toMatchObject({ constructor: CommandExecutionError, hint: expect.stringContaining('Stop retrying') });
    await expect(command.func(makePage({ kind: 'malformed', detail: 'payload is missing data.children' }), { query: 'x' }))
      .rejects.toBeInstanceOf(CommandExecutionError);
    await expect(command.func(makePage({ kind: 'exception', detail: 'bridge failed' }), { query: 'x' }))
      .rejects.toThrow('bridge failed');
  });
});
