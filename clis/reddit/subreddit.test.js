import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './subreddit.js';

describe('reddit subreddit adapter', () => {
  const command = getRegistry().get('reddit/subreddit');

  it('exposes the full subreddit-list shape including the 4 media columns', () => {
    expect(command?.columns).toEqual([
      'id', 'title', 'subreddit', 'author', 'upvotes', 'comments', 'url',
      'created_utc', 'selftext',
      'post_hint', 'url_overridden_by_dest', 'preview_image_url', 'gallery_urls',
    ]);
  });

  it('shapes children into the intermediate-object pattern with media spread in', () => {
    expect(command?.pipeline?.[1]?.evaluate).toContain('function extractRedditMedia');
    expect(command?.pipeline?.[1]?.evaluate).toContain('...extractRedditMedia(c.data)');
    expect(command?.pipeline?.[2]?.map).toMatchObject({
      title: '${{ item.title }}',
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
