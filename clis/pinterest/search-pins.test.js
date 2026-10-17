import { beforeAll, describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';

import { createPageMock } from '../test-utils.js';
import './search-pins.js';

let cmd;

/** Wrap raw pin results in the resource_response envelope the endpoint returns. */
function searchResponse(results, bookmark = null) {
  return { resource_response: { data: { results }, bookmark } };
}

function pin(overrides = {}) {
  return {
    type: 'pin',
    id: '111',
    title: 'Cozy Nordic Living Room',
    description: 'Soft neutral tones and light wood.',
    pinner: { username: 'janedoe' },
    board: { name: 'Home' },
    images: { orig: { url: 'https://i.pinimg.com/originals/aa/bb/cc.jpg' } },
    ...overrides,
  };
}

beforeAll(() => {
  cmd = getRegistry().get('pinterest/search-pins');
  expect(cmd?.func).toBeTypeOf('function');
});

describe('pinterest search-pins', () => {

  it('respects the limit and stops paginating once satisfied', async () => {
    const page = createPageMock([searchResponse([pin({ id: '1' }), pin({ id: '2' }), pin({ id: '3' })], 'bm1')]);
    const result = await cmd.func(page, { query: 'x', limit: 2 });
    expect(result).toHaveLength(2);
    // Only one page fetched: the second queued response is never consumed.
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });

  it('paginates across pages via the bookmark, de-duplicating pins', async () => {
    const page = createPageMock([
      searchResponse([pin({ id: '1' }), pin({ id: '2' })], 'bm1'),
      searchResponse([pin({ id: '2' }), pin({ id: '3' })], null),
    ]);
    const result = await cmd.func(page, { query: 'x', limit: 5 });
    expect(result.map((r) => r.pinId)).toEqual(['1', '2', '3']);
    expect(page.evaluate).toHaveBeenCalledTimes(2);
  });

});
