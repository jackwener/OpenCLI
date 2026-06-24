import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './popular.js';

describe('reddit popular adapter', () => {
  const command = getRegistry().get('reddit/popular');

  it('exposes the full post-list shape including the 4 media columns', () => {
    expect(command?.columns).toEqual([
      'rank', 'id', 'title', 'subreddit', 'score', 'comments', 'author', 'url',
      'created_utc', 'selftext',
      'post_hint', 'url_overridden_by_dest', 'preview_image_url', 'gallery_urls',
    ]);
  });

  it('surfaces media via extractRedditMedia in evaluate + map', () => {
    expect(command?.pipeline?.[0]?.evaluate).toContain('function extractRedditMedia');
    expect(command?.pipeline?.[0]?.evaluate).toContain('...extractRedditMedia(c.data)');
    expect(command?.pipeline?.[1]?.map).toMatchObject({
      post_hint: '${{ item.post_hint }}',
      url_overridden_by_dest: '${{ item.url_overridden_by_dest }}',
      preview_image_url: '${{ item.preview_image_url }}',
      gallery_urls: '${{ item.gallery_urls }}',
    });
  });
});
