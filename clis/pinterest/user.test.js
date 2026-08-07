import { beforeAll, describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';
import { createPageMock } from '../test-utils.js';
import './user.js';

let cmd;

function profile(overrides = {}) {
  return {
    resource_response: {
      data: {
        username: 'janedoe',
        full_name: 'Jane Doe',
        follower_count: 83,
        following_count: 146,
        interest_following_count: 6,
        pin_count: 3135,
        board_count: 36,
        about: 'hi',
        domain_url: 'https://example.com',
        ...overrides,
      },
    },
  };
}

beforeAll(() => {
  cmd = getRegistry().get('pinterest/user');
  expect(cmd?.func).toBeTypeOf('function');
});

describe('pinterest user', () => {
  it('throws ArgumentError on blank username', async () => {
    await expect(cmd.func(createPageMock([]), { username: '  ' })).rejects.toThrow(ArgumentError);
  });

  it('throws AuthRequiredError on 401', async () => {
    await expect(cmd.func(createPageMock([{ __httpError: 401 }]), { username: 'janedoe' })).rejects.toThrow(AuthRequiredError);
  });

  it('maps the profile row', async () => {
    const result = await cmd.func(createPageMock([profile()]), { username: 'janedoe' });
    expect(result[0]).toEqual({
      username: 'janedoe',
      fullName: 'Jane Doe',
      followerCount: 83,
      followingCount: 146,
      interestFollowingCount: 6,
      pinCount: 3135,
      boardCount: 36,
      about: 'hi',
      website: 'https://example.com',
      url: 'https://www.pinterest.com/janedoe/',
    });
  });

  it('defaults missing counts/strings', async () => {
    const result = await cmd.func(createPageMock([profile({ follower_count: undefined, about: undefined, domain_url: undefined })]), { username: 'janedoe' });
    expect(result[0]).toMatchObject({ followerCount: 0, about: '', website: '' });
  });

  it('throws EmptyResultError when the user is missing', async () => {
    const page = createPageMock([{ resource_response: { data: {} } }]);
    await expect(cmd.func(page, { username: 'ghost' })).rejects.toThrow(EmptyResultError);
  });
});
