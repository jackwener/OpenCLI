import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './search.js';
import './top.js';

describe('apple-podcasts search command', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the positional query argument for the iTunes search request', async () => {
    const cmd = getRegistry().get('apple-podcasts/search');
    expect(cmd?.func).toBeTypeOf('function');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        results: [
          {
            collectionId: 42,
            collectionName: 'Machine Learning Guide',
            artistName: 'OpenCLI',
            trackCount: 12,
            primaryGenreName: 'Technology',
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await cmd!.func!(null as any, {
      query: 'machine learning',
      keyword: 'sports',
      limit: 5,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://itunes.apple.com/search?term=machine%20learning&media=podcast&limit=5',
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: 42,
        title: 'Machine Learning Guide',
        author: 'OpenCLI',
        episodes: 12,
        genre: 'Technology',
        url: '',
      }),
    ]);
  });
});

describe('apple-podcasts top command', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('adds a timeout signal to chart fetches', async () => {
    const cmd = getRegistry().get('apple-podcasts/top');
    expect(cmd?.func).toBeTypeOf('function');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        feed: {
          results: [
            { id: '100', name: 'Top Show', artistName: 'Host A' },
          ],
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await cmd!.func!(null as any, { country: 'US', limit: 1 });

    const [, options] = fetchMock.mock.calls[0] ?? [];
    expect(options).toBeDefined();
    expect(options.signal).toBeDefined();
    expect(options.signal).toHaveProperty('aborted', false);
  });

  it('uses the canonical Apple charts host and maps ranked results', async () => {
    const cmd = getRegistry().get('apple-podcasts/top');
    expect(cmd?.func).toBeTypeOf('function');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        feed: {
          results: [
            { id: '100', name: 'Top Show', artistName: 'Host A' },
            { id: '101', name: 'Second Show', artistName: 'Host B' },
          ],
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await cmd!.func!(null as any, { country: 'US', limit: 2 });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://rss.marketingtools.apple.com/api/v2/us/podcasts/top/2/podcasts.json',
      expect.objectContaining({
        signal: expect.any(Object),
      }),
    );
    expect(result).toEqual([
      { rank: 1, title: 'Top Show', author: 'Host A', id: '100' },
      { rank: 2, title: 'Second Show', author: 'Host B', id: '101' },
    ]);
  });

  it('normalizes network failures into CliError output', async () => {
    const cmd = getRegistry().get('apple-podcasts/top');
    expect(cmd?.func).toBeTypeOf('function');

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('socket hang up')));

    await expect(cmd!.func!(null as any, { country: 'us', limit: 3 })).rejects.toThrow(
      'Unable to reach Apple Podcasts charts for US',
    );
  });
});
