import { describe, expect, it, vi } from 'vitest';
import { AuthRequiredError, TimeoutError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import { registerSiteAuthCommands } from './site-auth.js';

function pageMock() {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
  };
}

describe('site auth command helper', () => {
  it('registers whoami and foreground login commands', () => {
    registerSiteAuthCommands({
      site: 'auth-helper-registration',
      domain: 'example.com',
      loginUrl: 'https://example.com/login',
      columns: ['username'],
      verify: async () => ({ username: 'alice' }),
    });

    expect(getRegistry().get('auth-helper-registration/whoami')).toMatchObject({
      access: 'read',
      browser: true,
      navigateBefore: false,
      columns: ['logged_in', 'site', 'username'],
    });
    expect(getRegistry().get('auth-helper-registration/login')).toMatchObject({
      access: 'write',
      browser: true,
      navigateBefore: false,
      defaultWindowMode: 'foreground',
      siteSession: 'persistent',
      columns: ['status', 'logged_in', 'site', 'username'],
    });
  });

  it('passes declared session cookie names through to auth status metadata', () => {
    registerSiteAuthCommands({
      site: 'auth-helper-session-cookies',
      domain: 'example.com',
      loginUrl: 'https://example.com/login',
      sessionCookies: ['sid'],
      verify: async () => ({ username: 'alice' }),
    });
    registerSiteAuthCommands({
      site: 'auth-helper-no-session-cookies',
      domain: 'example.com',
      loginUrl: 'https://example.com/login',
      verify: async () => ({ username: 'alice' }),
    });

    expect(getRegistry().get('auth-helper-session-cookies/whoami')?.authStatus?.sessionCookies).toEqual(['sid']);
    expect(getRegistry().get('auth-helper-no-session-cookies/whoami')?.authStatus).not.toHaveProperty('sessionCookies');
  });

  it('whoami returns normalized identity without opening login', async () => {
    registerSiteAuthCommands({
      site: 'auth-helper-whoami',
      domain: 'example.com',
      loginUrl: 'https://example.com/login',
      columns: ['username'],
      verify: async () => ({ username: 'alice' }),
    });
    const cmd = getRegistry().get('auth-helper-whoami/whoami');
    const page = pageMock();

    await expect(cmd.func(page, {})).resolves.toEqual({
      logged_in: true,
      site: 'auth-helper-whoami',
      username: 'alice',
    });
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('login opens the login URL and polls until authenticated', async () => {
    const poll = vi.fn()
      .mockRejectedValueOnce(new AuthRequiredError('example.com', 'not yet'))
      .mockResolvedValueOnce({ username: 'alice' });
    registerSiteAuthCommands({
      site: 'auth-helper-login',
      domain: 'example.com',
      loginUrl: 'https://example.com/login',
      columns: ['username'],
      verify: async () => { throw new AuthRequiredError('example.com', 'missing'); },
      poll,
    });
    const cmd = getRegistry().get('auth-helper-login/login');
    const page = pageMock();

    await expect(cmd.func(page, { timeout: 1 })).resolves.toEqual({
      status: 'login_complete',
      logged_in: true,
      site: 'auth-helper-login',
      username: 'alice',
    });
    expect(page.goto).toHaveBeenCalledWith('https://example.com/login');
    expect(page.wait).toHaveBeenCalled();
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('login times out when auth never completes', async () => {
    registerSiteAuthCommands({
      site: 'auth-helper-timeout',
      domain: 'example.com',
      loginUrl: 'https://example.com/login',
      verify: async () => { throw new AuthRequiredError('example.com', 'missing'); },
      poll: async () => { throw new AuthRequiredError('example.com', 'still missing'); },
    });
    const cmd = getRegistry().get('auth-helper-timeout/login');
    const page = pageMock();

    await expect(cmd.func(page, { timeout: 0 })).rejects.toBeInstanceOf(TimeoutError);
    expect(page.goto).toHaveBeenCalledWith('https://example.com/login');
  });
});

describe('auth result contracts', () => {
  function register(verify, quickCheck) {
    registerSiteAuthCommands({ site: 'contract', domain: 'example.com', loginUrl: 'https://example.com/login', verify, quickCheck });
    return getRegistry().get('contract/whoami');
  }
  it.each([undefined, null, [], {}, 'alice', { logged_in: null }, { logged_in: 'false' }])('rejects invalid identity %j', async identity => {
    const cmd = register(async () => identity);
    await expect(cmd.func(pageMock(), {})).rejects.toMatchObject({ code: 'COMMAND_EXEC' });
  });
  it('does not treat explicit logout as identity success', async () => {
    const cmd = register(async () => ({ logged_in: false }));
    await expect(cmd.func(pageMock(), {})).rejects.toBeInstanceOf(AuthRequiredError);
  });
  it('keeps the configured site authoritative', async () => {
    const cmd = register(async () => ({ site: 'wrong', username: 'alice' }));
    await expect(cmd.func(pageMock(), {})).resolves.toMatchObject({ site: 'contract' });
  });
  it.each([null, undefined, {}, { logged_in: null }, { logged_in: 'false' }])('preserves unknown quick checks %j', async result => {
    const cmd = register(async () => ({ username: 'alice' }), async () => result);
    await expect(cmd.authStatus.quickCheck(pageMock())).resolves.toMatchObject({ logged_in: null });
  });
});
