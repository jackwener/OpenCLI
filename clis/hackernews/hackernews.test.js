import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import './top.js';
import './best.js';
import './ask.js';
import './new.js';
import './show.js';
import './jobs.js';
import './search.js';
import './read.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('hackernews listing adapters expose item id', () => {
  const storyCommands = ['hackernews/top', 'hackernews/best', 'hackernews/ask', 'hackernews/new', 'hackernews/show'];

  storyCommands.forEach((key) => {
    it(`${key} surfaces id alongside title/score/author/comments/url`, () => {
      const cmd = getRegistry().get(key);
      expect(cmd?.columns).toEqual(['rank', 'id', 'title', 'score', 'author', 'comments', 'url']);
      expect(cmd?.pipeline?.[5]?.map).toMatchObject({
        id: '${{ item.id }}',
        url: '${{ item.url }}',
      });
    });
  });

  it('hackernews/jobs surfaces id alongside title/author/url', () => {
    const cmd = getRegistry().get('hackernews/jobs');
    expect(cmd?.columns).toEqual(['rank', 'id', 'title', 'author', 'url']);
    expect(cmd?.pipeline?.[5]?.map).toMatchObject({
      id: '${{ item.id }}',
      url: '${{ item.url }}',
    });
  });

  it('hackernews/search surfaces id (algolia objectID) alongside the existing columns', () => {
    const cmd = getRegistry().get('hackernews/search');
    expect(cmd?.columns).toEqual(['rank', 'id', 'title', 'score', 'author', 'comments', 'url']);
    expect(cmd?.pipeline?.[2]?.map).toMatchObject({
      id: '${{ item.objectID }}',
    });
  });
});

describe('hackernews/read adapter', () => {
  const cmd = getRegistry().get('hackernews/read');

  it('registers the comment-thread shape (type/author/score/text)', () => {
    expect(cmd?.columns).toEqual(['type', 'author', 'score', 'text']);
  });

  it('takes a positional id plus tunable depth/limit/replies/max-length args', () => {
    const argNames = (cmd?.args || []).map((a) => a.name);
    expect(argNames).toEqual(['id', 'limit', 'depth', 'replies', 'max-length']);
    const idArg = cmd?.args?.find((a) => a.name === 'id');
    expect(idArg?.required).toBe(true);
    expect(idArg?.positional).toBe(true);
  });

  it('uses the public Firebase API (no browser, public strategy)', () => {
    expect(cmd?.browser).toBe(false);
    expect(cmd?.strategy).toBe('public');
  });

  it('fails fast with ArgumentError for non-numeric ids before hitting fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(cmd.func({ id: 'abc', limit: 5, depth: 2, replies: 5, 'max-length': 2000 })).rejects.toThrow(ArgumentError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails fast with EmptyResultError when the story is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(null), { status: 200 })));

    await expect(cmd.func({ id: '99999999', limit: 5, depth: 2, replies: 5, 'max-length': 2000 })).rejects.toThrow(EmptyResultError);
  });

  it('renders story body, anchor text, and hidden-replies stubs from the public API tree', async () => {
    const items = new Map([
      ['123', {
        id: 123,
        type: 'story',
        by: 'pg',
        score: 42,
        title: 'Ask HN: Example',
        text: '<p>Hello <a href=\"https://example.com\">world</a></p>',
        url: 'https://news.ycombinator.com/item?id=123',
        kids: [456],
      }],
      ['456', {
        id: 456,
        type: 'comment',
        by: 'sama',
        text: '<p>Top level</p>',
        kids: [789],
      }],
    ]);
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const id = String(url).match(/item\/(\d+)\.json$/)?.[1];
      return new Response(JSON.stringify(items.get(id) ?? null), { status: 200 });
    }));

    const rows = await cmd.func({ id: '123', limit: 5, depth: 1, replies: 5, 'max-length': 2000 });

    expect(rows).toEqual([
      {
        type: 'POST',
        author: 'pg',
        score: 42,
        text: 'Ask HN: Example\nHello world (https://example.com)\nhttps://news.ycombinator.com/item?id=123',
      },
      {
        type: 'L0',
        author: 'sama',
        score: '',
        text: 'Top level',
      },
      {
        type: 'L1',
        author: '',
        score: '',
        text: '  [+1 more replies]',
      },
    ]);
  });
});
