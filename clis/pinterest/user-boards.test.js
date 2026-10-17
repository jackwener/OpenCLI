import { beforeAll, describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';

import { createPageMock } from '../test-utils.js';
import './user-boards.js';

let cmd;

function feed(results, bookmark = null) {
  return { resource_response: { data: results, bookmark } };
}

function board(overrides = {}) {
  return { id: '999', name: 'My Board', pin_count: 245, section_count: 4, privacy: 'public', url: '/janedoe/my-board/', ...overrides };
}

beforeAll(() => {
  cmd = getRegistry().get('pinterest/user-boards');
  expect(cmd?.func).toBeTypeOf('function');
});

describe('pinterest user-boards', () => {

  it('paginates via bookmark and de-duplicates by boardId', async () => {
    const page = createPageMock([
      feed([board({ id: '1' }), board({ id: '2' })], 'bm1'),
      feed([board({ id: '2' }), board({ id: '3' })], null),
    ]);
    const result = await cmd.func(page, { username: 'janedoe', limit: 10 });
    expect(result.map((r) => r.boardId)).toEqual(['1', '2', '3']);
  });

});
