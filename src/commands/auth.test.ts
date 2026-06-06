import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserCliCommand } from '../registry.js';

const executeCommandMock = vi.hoisted(() => vi.fn());

vi.mock('../execution.js', () => ({
  executeCommand: executeCommandMock,
}));

import { collectAuthStatus } from './auth.js';
import { AuthRequiredError } from '../errors.js';
import { cli, getRegistry, Strategy } from '../registry.js';

function registerWhoami(site: string, opts: {
  quick?: boolean;
  quickLoggedIn?: boolean;
  identity?: Record<string, unknown>;
} = {}): void {
  cli({
    site,
    name: 'whoami',
    access: 'read',
    description: `${site} whoami`,
    strategy: Strategy.COOKIE,
    browser: true,
    domain: `${site}.example.com`,
    navigateBefore: false,
    args: [],
    columns: ['logged_in', 'site', 'username'],
    authStatus: opts.quick
      ? { quickCheck: async () => ({ logged_in: opts.quickLoggedIn ?? false }) }
      : undefined,
    func: async () => opts.identity ?? { logged_in: true, site, username: site },
  });
}

beforeEach(() => {
  getRegistry().clear();
  executeCommandMock.mockReset();
  executeCommandMock.mockImplementation(async (cmd: BrowserCliCommand, kwargs: Record<string, unknown>) => {
    if (!cmd.func) return {};
    return cmd.func({} as never, kwargs);
  });
});

describe('auth status collection', () => {
  it('uses quickCheck by default and does not run full whoami', async () => {
    registerWhoami('alpha', { quick: true, quickLoggedIn: true, identity: { username: 'full-alpha' } });

    const rows = await collectAuthStatus({ sites: 'alpha' });

    expect(rows).toEqual([
      { site: 'alpha', status: 'logged_in', logged_in: true, identity: '', checked: 'quick', error: '' },
    ]);
    expect(executeCommandMock).toHaveBeenCalledTimes(1);
    expect(executeCommandMock.mock.calls[0]?.[0]).toMatchObject({
      site: 'alpha',
      name: 'whoami',
      navigateBefore: false,
      siteSession: 'ephemeral',
      defaultWindowMode: 'background',
    });
  });

  it('marks sites without quickCheck as unknown unless --full is used', async () => {
    registerWhoami('beta');

    const rows = await collectAuthStatus({ sites: 'beta' });

    expect(rows).toEqual([
      {
        site: 'beta',
        status: 'unknown',
        logged_in: '',
        identity: '',
        checked: 'skipped',
        error: 'quickCheck not implemented; use --full to run whoami',
      },
    ]);
    expect(executeCommandMock).not.toHaveBeenCalled();
  });

  it('runs full whoami with --full and returns a safe identity summary', async () => {
    registerWhoami('gamma', {
      identity: {
        logged_in: true,
        site: 'gamma',
        email: 'hidden@example.com',
        username: 'public-handle',
      },
    });

    const rows = await collectAuthStatus({ sites: 'gamma', full: true });

    expect(rows).toEqual([
      { site: 'gamma', status: 'logged_in', logged_in: true, identity: 'public-handle', checked: 'full', error: '' },
    ]);
  });

  it('converts AuthRequiredError into not_logged_in rows', async () => {
    registerWhoami('delta', { quick: true });
    executeCommandMock.mockRejectedValueOnce(new AuthRequiredError('delta.example.com'));

    const rows = await collectAuthStatus({ sites: 'delta' });

    expect(rows).toEqual([
      { site: 'delta', status: 'not_logged_in', logged_in: false, identity: '', checked: 'quick', error: '' },
    ]);
  });
});
