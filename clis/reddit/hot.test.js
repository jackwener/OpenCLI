import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './hot.js';

function runHotEvaluate(fetch, { subreddit = '', limit = 3 } = {}) {
  const script = getRegistry().get('reddit/hot').pipeline[1].evaluate
    .replace('${{ args.subreddit | json }}', JSON.stringify(subreddit))
    .replace('${{ args.limit }}', String(limit));
  return Function('fetch', `return ${script}`)(fetch);
}

function listing(children) {
  return { kind: 'Listing', data: { dist: children.length, children } };
}

describe('reddit hot adapter', () => {
  const command = getRegistry().get('reddit/hot');

  it('registers postId, author, and url columns in the hot-list shape', () => {
    expect(command?.columns).toEqual([
      'rank', 'title', 'subreddit', 'score', 'comments', 'postId', 'author', 'url',
      'post_hint', 'url_overridden_by_dest', 'preview_image_url', 'gallery_urls',
    ]);
    expect(command?.pipeline?.[1]?.evaluate).toContain('postId: c.data.id');
    expect(command?.pipeline?.[1]?.evaluate).toContain("'https://www.reddit.com' + c.data.permalink");
    expect(command?.pipeline?.[2]?.map).toMatchObject({
      postId: '${{ item.postId }}',
      author: '${{ item.author }}',
      url: '${{ item.url }}',
    });
  });

  it('surfaces post_hint, url_overridden_by_dest, preview_image_url, gallery_urls via extractRedditMedia', () => {
    expect(command?.pipeline?.[1]?.evaluate).toContain('function extractRedditMedia');
    expect(command?.pipeline?.[1]?.evaluate).toContain('...extractRedditMedia(c.data)');
    expect(command?.pipeline?.[2]?.map).toMatchObject({
      post_hint: '${{ item.post_hint }}',
      url_overridden_by_dest: '${{ item.url_overridden_by_dest }}',
      preview_image_url: '${{ item.preview_image_url }}',
      gallery_urls: '${{ item.gallery_urls }}',
    });
  });

  it('uses the working popular hot feed when no subreddit is selected', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => listing([{ data: {
        id: 'abc', title: 'Post', subreddit_name_prefixed: 'r/test', score: 7,
        num_comments: 2, author: 'user', permalink: '/r/test/comments/abc/post/',
      } }]),
    }));

    await expect(runHotEvaluate(fetch)).resolves.toMatchObject([{ postId: 'abc', title: 'Post' }]);
    expect(fetch).toHaveBeenCalledWith('/r/popular/hot.json?limit=3&raw_json=1', { credentials: 'include' });
  });

  it('keeps subreddit hot requests on their selected subreddit', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => listing([{ data: { id: 'abc' } }]) }));
    await runHotEvaluate(fetch, { subreddit: 'LocalLLaMA', limit: 2 });
    expect(fetch).toHaveBeenCalledWith('/r/LocalLLaMA/hot.json?limit=2&raw_json=1', { credentials: 'include' });
  });

  it('reports HTTP, malformed, and empty listings instead of returning an empty result', async () => {
    await expect(runHotEvaluate(async () => ({ ok: false, status: 503 }))).rejects.toThrow(/HTTP 503/);
    await expect(runHotEvaluate(async () => ({ ok: true, json: async () => ({ data: { children: [] } }) })))
      .rejects.toThrow(/Listing/);
    await expect(runHotEvaluate(async () => ({ ok: true, json: async () => listing([]) })))
      .rejects.toThrow(/empty.*dist=0/i);
  });
});
