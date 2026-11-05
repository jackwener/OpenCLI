import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { AuthRequiredError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './auth.js';

const whoami = getRegistry().get('youtube/whoami');
const login = getRegistry().get('youtube/login');

function createPage({ cookies = [], probes = [], hosts = [] } = {}) {
  return {
    getCookies: vi.fn().mockResolvedValue(cookies.map(name => ({ name }))),
    goto: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn(async script => {
      if (script === 'location.hostname') return hosts.shift() ?? 'www.youtube.com';
      const probe = probes.shift() ?? { loggedIn: true };
      return runInNewContext(script, {
        window: {
          ytcfg: {
            get(key) {
              if (key === 'LOGGED_IN') return probe.loggedIn;
              if (key === 'INNERTUBE_CONTEXT') return { user: { identityName: probe.name } };
              return undefined;
            },
          },
        },
        document: {
          querySelector(selector) {
            if (selector === '#avatar-btn' && probe.avatarLabel) {
              return { getAttribute: () => probe.avatarLabel };
            }
            return null;
          },
        },
      });
    }),
  };
}

describe('youtube auth', () => {
  it('quick-check recognizes the 3P cookies used by the current YouTube session', async () => {
    const page = createPage({ cookies: ['LOGIN_INFO', '__Secure-3PSID', '__Secure-3PAPISID'] });
    await expect(whoami.authStatus.quickCheck(page)).resolves.toEqual({ logged_in: true });
  });

  it('whoami trusts YouTube page login state without a recognized cookie', async () => {
    const page = createPage({ probes: [{ loggedIn: true, name: 'Example channel' }] });
    await expect(whoami.func(page, {})).resolves.toMatchObject({ logged_in: true, name: 'Example channel' });
    expect(page.getCookies).not.toHaveBeenCalled();
    expect(page.goto).toHaveBeenCalledWith('https://www.youtube.com/');
  });

  it('does not override an explicit logged-out flag with the avatar menu', async () => {
    const page = createPage({ probes: [{ loggedIn: false, avatarLabel: '账号菜单' }] });
    await expect(whoami.func(page, {})).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('does not return a localized avatar menu label as the account name', async () => {
    const page = createPage({ probes: [{ loggedIn: true, avatarLabel: '账号菜单' }] });
    await expect(whoami.func(page, {})).resolves.toMatchObject({ logged_in: true, name: '' });
  });

  it('login polling waits on the Google sign-in page and then reads YouTube page state in place', async () => {
    const page = createPage({
      probes: [{ loggedIn: false }, { loggedIn: true, name: 'Example channel' }],
      hosts: ['accounts.google.com', 'accounts.google.com', 'www.youtube.com'],
    });
    await expect(login.func(page, { timeout: 30 })).resolves.toMatchObject({
      status: 'login_complete',
      logged_in: true,
      name: 'Example channel',
    });
    expect(page.getCookies).not.toHaveBeenCalled();
    // Only the initial identity check and the login page; polling must not navigate the sign-in tab away.
    expect(page.goto.mock.calls.map(([url]) => url)).toEqual([
      'https://www.youtube.com/',
      expect.stringContaining('https://accounts.google.com/ServiceLogin'),
    ]);
    expect(page.evaluate.mock.calls.filter(([script]) => script === 'location.hostname')).toHaveLength(3);
  });
});
