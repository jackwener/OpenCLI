import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { createPageMock } from '../test-utils.js';
import './me.js';

let cmd;

beforeAll(() => {
  cmd = getRegistry().get('pixiv/me');
  expect(cmd?.func).toBeTypeOf('function');
});

describe('pixiv me', () => {
  it('returns current logged-in account metadata', async () => {
    const page = createPageMock([{
      id: '37119297',
      name: '示例用户',
      premium: true,
      profileImageUrl: 'https://i.pximg.net/user-profile/img.jpg',
    }]);

    await expect(cmd.func(page, {})).resolves.toEqual([{
      user_id: '37119297',
      name: '示例用户',
      premium: true,
      profile_image: 'https://i.pximg.net/user-profile/img.jpg',
      url: 'https://www.pixiv.net/users/37119297',
    }]);
  });

  it('accepts sparse current user data from trusted Pixiv globals', async () => {
    const page = createPageMock([{
      id: '66676548',
      name: '_ *',
      profileImageUrl: '',
    }]);

    await expect(cmd.func(page, {})).resolves.toEqual([{
      user_id: '66676548',
      name: '_ *',
      premium: false,
      profile_image: '',
      url: 'https://www.pixiv.net/users/66676548',
    }]);
  });

  it('does not use arbitrary profile links as current-account proof', () => {
    const source = readFileSync(new URL('./utils.js', import.meta.url), 'utf8');
    expect(source).not.toContain("querySelectorAll('a[href]')");
  });

  it('throws AuthRequiredError when Pixiv has no current user data', async () => {
    const page = createPageMock([null]);
    await expect(cmd.func(page, {})).rejects.toThrow(AuthRequiredError);
  });

  it('wraps browser evaluation failures as CommandExecutionError', async () => {
    const page = createPageMock([]);
    page.evaluate.mockRejectedValueOnce(new Error('bridge down'));
    await expect(cmd.func(page, {})).rejects.toThrow(CommandExecutionError);
  });
});
