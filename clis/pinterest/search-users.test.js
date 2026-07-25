import { beforeAll, describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { createPageMock } from '../test-utils.js';
import './search-users.js';

let cmd;

function feed(results, bookmark = null) {
  return { resource_response: { data: { results }, bookmark } };
}

function user(overrides = {}) {
  return { type: 'user', id: 'u1', username: 'mrcoffee', full_name: 'Mr Coffee', follower_count: 22441, pin_count: 500, ...overrides };
}

beforeAll(() => {
  cmd = getRegistry().get('pinterest/search-users');
  expect(cmd?.func).toBeTypeOf('function');
});

describe('pinterest search-users', () => {
  it('throws ArgumentError on blank query', async () => {
    await expect(cmd.func(createPageMock([]), { query: '  ' })).rejects.toThrow(ArgumentError);
  });

  it('maps user fields and skips non-user items', async () => {
    const page = createPageMock([feed([user({ username: 'a' }), { type: 'pin', id: 'p' }, user({ username: 'b' })])]);
    const result = await cmd.func(page, { query: 'coffee', limit: 10 });
    expect(result.map((r) => r.username)).toEqual(['a', 'b']);
    expect(result[0]).toEqual({
      username: 'a',
      fullName: 'Mr Coffee',
      followerCount: 22441,
      pinCount: 500,
      url: 'https://www.pinterest.com/a/',
    });
  });

  it('throws EmptyResultError when nothing matches', async () => {
    await expect(cmd.func(createPageMock([feed([], null)]), { query: 'zzz' })).rejects.toThrow(EmptyResultError);
  });
});
