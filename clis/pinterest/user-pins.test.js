import { beforeAll, describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';

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

});
