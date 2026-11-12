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

  it('passes --privacy through and rejects an unknown value', async () => {
    const page = createPageMock([feed([board({ privacy: 'secret' })])]);
    const [row] = await cmd.func(page, { username: 'janedoe', privacy: 'secret' });
    expect(row).toMatchObject({ privacy: 'secret' });
    const sent = JSON.parse(decodeURIComponent(page.evaluate.mock.calls[0][0].match(/data=([^"&]+)/)[1]));
    expect(sent.options.privacy_filter).toBe('secret');

    await expect(cmd.func(createPageMock([]), { username: 'janedoe', privacy: 'hidden' })).rejects.toThrow(/Unknown privacy/);
  });

});
