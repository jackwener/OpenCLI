import { beforeAll, describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';

import { createPageMock } from '../test-utils.js';
import './user-pins.js';

let cmd;

function feed(results, bookmark = null) {
  return { resource_response: { data: { results }, bookmark } };
}

function pin(overrides = {}) {
  return {
    type: 'pin',
    id: '111',
    title: 'Nordic Chair',
    description: 'Light wood.',
    pinner: { username: 'janedoe' },
    board: { name: 'Furniture' },
    images: { orig: { url: 'https://i.pinimg.com/originals/a/b/c.jpg' } },
    ...overrides,
  };
}

beforeAll(() => {
  cmd = getRegistry().get('pinterest/user-pins');
  expect(cmd?.func).toBeTypeOf('function');
});

describe('pinterest user-pins', () => {

  it('paginates via bookmark and de-duplicates', async () => {
    const page = createPageMock([
      feed([pin({ id: '1' }), pin({ id: '2' })], 'bm1'),
      feed([pin({ id: '2' }), pin({ id: '3' })], null),
    ]);
    const result = await cmd.func(page, { username: 'janedoe', limit: 5 });
    expect(result.map((r) => r.pinId)).toEqual(['1', '2', '3']);
    expect(page.evaluate).toHaveBeenCalledTimes(2);
  });

  it('stamps every row with the cursor for the next page, and "" at the end of the feed', async () => {
    const more = createPageMock([feed([pin({ id: '1' }), pin({ id: '2' })], 'bm1')]);
    expect((await cmd.func(more, { username: 'janedoe', limit: 2 })).map((r) => r.nextBookmark)).toEqual(['bm1', 'bm1']);

    const end = createPageMock([feed([pin({ id: '1' })], '-end-')]);
    expect((await cmd.func(end, { username: 'janedoe', limit: 5 }))[0].nextBookmark).toBe('');
  });

  it('resumes from --bookmark, asking only for the rows still missing', async () => {
    const page = createPageMock([feed([pin({ id: '9' })], null)]);
    await cmd.func(page, { username: 'janedoe', limit: 7, bookmark: 'bm1' });
    const sent = JSON.parse(decodeURIComponent(page.evaluate.mock.calls[0][0].match(/data=([^"&]+)/)[1]));
    expect(sent.options).toMatchObject({ page_size: 7, bookmarks: ['bm1'] });
  });

  it('keeps surplus rows instead of dropping them, so resuming cannot skip any', async () => {
    const page = createPageMock([feed([pin({ id: '1' }), pin({ id: '2' }), pin({ id: '3' })], 'bm1')]);
    const result = await cmd.func(page, { username: 'janedoe', limit: 2 });
    expect(result.map((r) => r.pinId)).toEqual(['1', '2', '3']);
    expect(result[0].nextBookmark).toBe('bm1');
  });

  it('rejects the end-of-feed sentinel as a bookmark', async () => {
    await expect(cmd.func(createPageMock([]), { username: 'janedoe', bookmark: '-end-' })).rejects.toThrow(ArgumentError);
  });

});
