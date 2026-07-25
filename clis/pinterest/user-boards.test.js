import { beforeAll, describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';
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
  it('throws ArgumentError on blank username', async () => {
    await expect(cmd.func(createPageMock([]), { username: '  ' })).rejects.toThrow(ArgumentError);
  });

  it('throws ArgumentError on an unknown sort', async () => {
    await expect(cmd.func(createPageMock([]), { username: 'janedoe', sort: 'nope' })).rejects.toThrow(ArgumentError);
  });

  it('throws AuthRequiredError on 401', async () => {
    await expect(cmd.func(createPageMock([{ __httpError: 401 }]), { username: 'janedoe' })).rejects.toThrow(AuthRequiredError);
  });

  it('maps board fields', async () => {
    const page = createPageMock([feed([board()])]);
    const result = await cmd.func(page, { username: 'janedoe', limit: 10 });
    expect(result[0]).toEqual({
      boardId: '999',
      name: 'My Board',
      pinCount: 245,
      sectionCount: 4,
      privacy: 'public',
      url: 'https://www.pinterest.com/janedoe/my-board/',
    });
  });

  it('paginates via bookmark and de-duplicates by boardId', async () => {
    const page = createPageMock([
      feed([board({ id: '1' }), board({ id: '2' })], 'bm1'),
      feed([board({ id: '2' }), board({ id: '3' })], null),
    ]);
    const result = await cmd.func(page, { username: 'janedoe', limit: 10 });
    expect(result.map((r) => r.boardId)).toEqual(['1', '2', '3']);
  });

  it('throws EmptyResultError when the user has no boards', async () => {
    await expect(cmd.func(createPageMock([feed([], null)]), { username: 'ghost' })).rejects.toThrow(EmptyResultError);
  });
});
