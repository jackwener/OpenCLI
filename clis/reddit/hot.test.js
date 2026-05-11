import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './hot.js';

describe('reddit hot adapter', () => {
  const command = getRegistry().get('reddit/hot');

  it('registers postId, author, and url columns in the hot-list shape', () => {
    expect(command?.columns).toEqual(['rank', 'title', 'subreddit', 'score', 'comments', 'postId', 'author', 'url']);
    expect(command?.pipeline?.[1]?.evaluate).toContain('postId: c.data.id');
    expect(command?.pipeline?.[1]?.evaluate).toContain("'https://www.reddit.com' + c.data.permalink");
    expect(command?.pipeline?.[2]?.map).toMatchObject({
      postId: '${{ item.postId }}',
      author: '${{ item.author }}',
      url: '${{ item.url }}',
    });
  });
});
