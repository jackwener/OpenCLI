import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './frontpage.js';

describe('reddit frontpage adapter', () => {
  const command = getRegistry().get('reddit/frontpage');

  it('exposes the full frontpage shape including the 4 media columns', () => {
    expect(command?.columns).toEqual([
      'title', 'subreddit', 'author', 'upvotes', 'comments', 'url',
      'post_hint', 'url_overridden_by_dest', 'preview_image_url', 'gallery_urls',
    ]);
  });

  it('shapes children into the intermediate-object pattern with media spread in', () => {
    // Refactored from item.data.* templating to a uniform pre-shaped object
    // so gallery_urls (array-valued) can be set directly in evaluate.
    expect(command?.pipeline?.[1]?.evaluate).toContain('function extractRedditMedia');
    expect(command?.pipeline?.[1]?.evaluate).toContain('...extractRedditMedia(c.data)');
    expect(command?.pipeline?.[1]?.evaluate).toContain('/r/all.json?limit=${{ args.limit }}&raw_json=1');
    expect(command?.pipeline?.[2]?.map).toMatchObject({
      title: '${{ item.title }}',
      subreddit: '${{ item.subreddit }}',
      author: '${{ item.author }}',
      upvotes: '${{ item.upvotes }}',
      comments: '${{ item.comments }}',
      url: '${{ item.url }}',
      post_hint: '${{ item.post_hint }}',
      url_overridden_by_dest: '${{ item.url_overridden_by_dest }}',
      preview_image_url: '${{ item.preview_image_url }}',
      gallery_urls: '${{ item.gallery_urls }}',
    });
  });
});
