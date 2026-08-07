import { beforeAll, describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { createPageMock } from '../test-utils.js';
import './search-boards.js';

let cmd;

function feed(results, bookmark = null) {
  return { resource_response: { data: { results }, bookmark } };
}

function board(overrides = {}) {
  return { type: 'board', id: '999', name: 'Coffee', pin_count: 120, owner: { username: 'barista' }, description: 'beans', url: '/barista/coffee/', ...overrides };
}

beforeAll(() => {
  cmd = getRegistry().get('pinterest/search-boards');
  expect(cmd?.func).toBeTypeOf('function');
});

describe('pinterest search-boards', () => {
  it('throws ArgumentError on blank query', async () => {
    await expect(cmd.func(createPageMock([]), { query: '  ' })).rejects.toThrow(ArgumentError);
  });

  it('maps board fields and skips non-board items', async () => {
    const page = createPageMock([feed([board({ id: '1' }), { type: 'pin', id: 'p' }, board({ id: '2' })])]);
    const result = await cmd.func(page, { query: 'coffee', limit: 10 });
    expect(result.map((r) => r.boardId)).toEqual(['1', '2']);
    expect(result[0]).toEqual({
      boardId: '1',
      name: 'Coffee',
      pinCount: 120,
      owner: 'barista',
      description: 'beans',
      url: 'https://www.pinterest.com/barista/coffee/',
    });
  });

  it('throws EmptyResultError when nothing matches', async () => {
    await expect(cmd.func(createPageMock([feed([], null)]), { query: 'zzz' })).rejects.toThrow(EmptyResultError);
  });
});
