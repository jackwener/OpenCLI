import { beforeAll, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { createPageMock } from '../test-utils.js';
import './me.js';

let cmd;
const sessionCookies = [{ name: 'PHPSESSID', value: '37119297_session' }];
const loggedInPage = (results, cookies = sessionCookies) => createPageMock(results, {
  getCookies: vi.fn().mockResolvedValue(cookies),
});

beforeAll(() => {
  cmd = getRegistry().get('pixiv/me');
  expect(cmd?.func).toBeTypeOf('function');
});

describe('pixiv me', () => {
  it('returns current logged-in account metadata from the executable carrier', async () => {
    const page = loggedInPage([{ found: true, user: {
      id: '37119297',
      name: '示例用户',
      premium: true,
      profileImageUrl: 'https://i.pximg.net/user-profile/img.jpg',
    } }]);

    await expect(cmd.func(page, {})).resolves.toEqual([{
      user_id: '37119297',
      name: '示例用户',
      premium: true,
      profile_image: 'https://i.pximg.net/user-profile/img.jpg',
      url: 'https://www.pixiv.net/users/37119297',
    }]);
  });

  it('unwraps Browser Bridge envelopes and accepts sparse trusted user data', async () => {
    const page = loggedInPage([{ session: 's', data: { found: true, user: {
      id: '66676548',
      name: '_ *',
      profileImageUrl: '',
    } } }], [{ name: 'PHPSESSID', value: '66676548_session' }]);

    await expect(cmd.func(page, {})).resolves.toEqual([{
      user_id: '66676548',
      name: '_ *',
      premium: false,
      profile_image: '',
      url: 'https://www.pixiv.net/users/66676548',
    }]);
  });

  it('does not trust visible identity data without an authenticated session cookie', async () => {
    const page = createPageMock([{ found: true, user: { id: '37119297', name: 'visible user' } }]);
    await expect(cmd.func(page, {})).rejects.toThrow(AuthRequiredError);
  });

  it('uses the authenticated session id when optional account metadata is absent', async () => {
    const page = loggedInPage([{ found: false, user: null }]);
    await expect(cmd.func(page, {})).resolves.toEqual([{
      user_id: '37119297',
      name: '',
      premium: false,
      profile_image: '',
      url: 'https://www.pixiv.net/users/37119297',
    }]);
  });

  it('fails typed on malformed found identities and off-host profile images', async () => {
    const malformed = loggedInPage([{ found: true, user: { id: '../escape' } }]);
    await expect(cmd.func(malformed, {})).rejects.toThrow(CommandExecutionError);

    const offHost = loggedInPage([{ found: true, user: {
      id: '1', name: 'user', profileImageUrl: 'https://evil.example/avatar.jpg',
    } }]);
    await expect(cmd.func(offHost, {})).rejects.toThrow(CommandExecutionError);
  });

  it('fails typed when page metadata names a different account than the session', async () => {
    const page = loggedInPage([{ found: true, user: { id: '999', name: 'other' } }]);
    await expect(cmd.func(page, {})).rejects.toThrow(/did not match/);
  });

  it('fails typed on malformed carrier data', async () => {
    const page = loggedInPage([{ id: '37119297' }]);
    await expect(cmd.func(page, {})).rejects.toThrow(CommandExecutionError);
  });

  it('wraps browser evaluation failures as CommandExecutionError', async () => {
    const page = loggedInPage([]);
    page.evaluate.mockRejectedValueOnce(new Error('bridge down'));
    await expect(cmd.func(page, {})).rejects.toThrow(CommandExecutionError);
  });
});
