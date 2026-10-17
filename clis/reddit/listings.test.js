import { createContext, runInContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { executePipeline } from '@jackwener/opencli/pipeline';
import './hot.js';
import './frontpage.js';
import './popular.js';
import './subreddit.js';

it.each([
  ['hot', { subreddit: 'pics' }, '/r/pics/hot.json?limit=1&raw_json=1'],
  ['frontpage', {}, '/r/all.json?limit=1&raw_json=1'],
  ['popular', {}, '/r/popular.json?limit=1&raw_json=1'],
  ['subreddit', { name: 'r/pics', sort: 'top', time: 'week' }, '/r/pics/top.json?limit=1&raw_json=1&t=week'],
])('reddit/%s runs its pipeline and preserves media arrays', async (name, args, url) => {
  const data = { id: 'abc', title: 'Photo', subreddit_name_prefixed: 'r/pics', author: 'Alice', score: 12,
    num_comments: 3, permalink: '/r/pics/comments/abc', post_hint: 'image', url_overridden_by_dest: 'https://img.test/main',
    preview: { images: [{ source: { url: 'https://img.test/preview?a=1&amp;b=2' } }] },
    gallery_data: { items: [{ media_id: 'one' }] }, media_metadata: { one: { s: { u: 'https://img.test/gallery?a=1&amp;b=2' } } },
  };
  const fetch = vi.fn().mockResolvedValue({ json: async () => ({ data: { children: [{ data }, { data }] } }) });
  const context = createContext({ fetch });
  const page = { goto: vi.fn(), evaluate: async code => runInContext(code, context) };
  const rows = await executePipeline(page, getRegistry().get(`reddit/${name}`).pipeline, { args: { ...args, limit: 1 } });
  expect(fetch).toHaveBeenCalledWith(url, { credentials: 'include' });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ title: 'Photo', author: 'Alice', comments: 3,
    post_hint: 'image', url_overridden_by_dest: 'https://img.test/main',
    preview_image_url: 'https://img.test/preview?a=1&b=2', gallery_urls: ['https://img.test/gallery?a=1&b=2'],
  });
});
