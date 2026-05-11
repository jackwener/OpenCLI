import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './hot.js';

describe('bilibili hot adapter', () => {
  const command = getRegistry().get('bilibili/hot');

  it('registers bvid and url columns in the public hot-list shape', () => {
    expect(command?.columns).toEqual(['rank', 'title', 'author', 'play', 'danmaku', 'bvid', 'url']);
    expect(command?.pipeline?.[1]?.evaluate).toContain('bvid: item.bvid');
    expect(command?.pipeline?.[1]?.evaluate).toContain("'https://www.bilibili.com/video/' + item.bvid");
    expect(command?.pipeline?.[2]?.map).toMatchObject({
      bvid: '${{ item.bvid }}',
      url: '${{ item.url }}',
    });
  });
});
