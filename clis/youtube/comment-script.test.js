import { expect, it } from 'vitest';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { buildCommentScript } from './comment.js';

it('preserves an accepted write when the first verification fetch rejects', async () => {
  let writes = 0;
  const continuation = { contents: { twoColumnWatchNextResults: { results: { results: { contents: [{ itemSectionRenderer: { targetId: 'comments-section', contents: [{ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'comments' } } } }] } }] } } } } };
  const fetch = async (url, opts) => {
    if (url.includes('create_comment')) {
      writes++;
      return { ok: true, status: 200, json: async () => ({ actions: [{ createCommentAction: { contents: { commentThreadRenderer: { commentId: 'created-id' } } } }] }) };
    }
    if (writes) throw new TypeError('Failed to fetch');
    const args = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => args.continuation ? { createCommentParams: 'params' } : continuation };
  };
  const context = { window: { ytcfg: { data_: { INNERTUBE_API_KEY: 'key', INNERTUBE_CONTEXT: {} } } }, crypto: webcrypto, TextEncoder, fetch, setTimeout: (f) => f() };
  const result = await vm.runInNewContext(buildCommentScript({ sapisid: 'cookie', videoId: 'dQw4w9WgXcQ', text: 'test' }), context).catch(error => ({ thrown: error.message }));
  expect(writes).toBe(1);
  expect(result).toMatchObject({ ok: true, commentId: 'created-id', visible: false });
});
