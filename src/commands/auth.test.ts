import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserCliCommand } from '../registry.js';

const executeCommandMock = vi.hoisted(() => vi.fn());

vi.mock('../execution.js', () => ({
  executeCommand: executeCommandMock,
}));

import { collectAuthRefresh, collectAuthRefreshScheduled, collectAuthStatus } from './auth.js';
import { AuthRequiredError } from '../errors.js';
import { cli, getRegistry, Strategy } from '../registry.js';

function registerWhoami(site: string, opts: {
  quick?: boolean;
  quickLoggedIn?: boolean;
  refresh?: 'touched' | 'refreshed';
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
    authStatus: {
      ...(opts.quick ? { quickCheck: async () => ({ logged_in: opts.quickLoggedIn ?? false }) } : {}),
      ...(opts.refresh ? { refresh: async () => ({ status: opts.refresh }) } : {}),
    },
    func: async () => opts.identity ?? { logged_in: true, site, username: site },
  });
}

async function tempStatePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'opencli-auth-refresh-test-'));
  return join(dir, 'auth-refresh.json');
}

async function tempAppAuthRefreshPaths(): Promise<{ configPath: string; runStatePath: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'opencli-app-auth-refresh-test-'));
  return {
    configPath: join(dir, 'auth-refresh-config.json'),
    runStatePath: join(dir, 'auth-refresh-state.json'),
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

beforeEach(() => {
  getRegistry().clear();
  executeCommandMock.mockReset();
  executeCommandMock.mockImplementation(async (cmd: BrowserCliCommand, kwargs: Record<string, unknown>) => {
    if (!cmd.func) return {};
    return cmd.func({ goto: vi.fn(), wait: vi.fn() } as never, kwargs);
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

describe('auth refresh collection', () => {
  it('touches sites through persistent sessions and writes last_touched_at on success', async () => {
    registerWhoami('alpha', { quick: true, quickLoggedIn: true });
    const statePath = await tempStatePath();
    const now = new Date('2026-06-06T12:00:00.000Z');

    const rows = await collectAuthRefresh({ sites: 'alpha', statePath, now });

    expect(rows).toEqual([
      {
        site: 'alpha',
        status: 'touched',
        last_touched_at: now.toISOString(),
        next_refresh_at: '2026-06-07T12:00:00.000Z',
        error: '',
      },
    ]);
    expect(executeCommandMock).toHaveBeenCalledTimes(1);
    expect(executeCommandMock.mock.calls[0]?.[0]).toMatchObject({
      site: 'alpha',
      name: 'whoami',
      navigateBefore: false,
      siteSession: 'persistent',
      defaultWindowMode: 'background',
    });
    expect(executeCommandMock.mock.calls[0]?.[3]).toMatchObject({
      siteSession: 'persistent',
      keepTab: 'true',
      windowMode: 'background',
    });
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    expect(state.sites.alpha).toMatchObject({
      last_touched_at: now.toISOString(),
      last_attempt_at: now.toISOString(),
      last_status: 'touched',
    });
  });

  it('uses adapter refresh hooks when present and records refreshed', async () => {
    registerWhoami('beta', { refresh: 'refreshed' });
    const statePath = await tempStatePath();

    const rows = await collectAuthRefresh({
      sites: 'beta',
      statePath,
      now: new Date('2026-06-06T12:00:00.000Z'),
    });

    expect(rows[0]?.status).toBe('refreshed');
    expect(executeCommandMock).toHaveBeenCalledTimes(1);
  });

  it('skips sites touched within the hidden 24h throttle', async () => {
    registerWhoami('gamma', { quick: true, quickLoggedIn: true });
    const statePath = await tempStatePath();
    await collectAuthRefresh({
      sites: 'gamma',
      statePath,
      now: new Date('2026-06-06T12:00:00.000Z'),
    });
    executeCommandMock.mockClear();

    const rows = await collectAuthRefresh({
      sites: 'gamma',
      statePath,
      now: new Date('2026-06-07T11:59:00.000Z'),
    });

    expect(rows).toEqual([
      {
        site: 'gamma',
        status: 'skipped',
        last_touched_at: '2026-06-06T12:00:00.000Z',
        next_refresh_at: '2026-06-07T12:00:00.000Z',
        error: '',
      },
    ]);
    expect(executeCommandMock).not.toHaveBeenCalled();
  });

  it('lets --all bypass the 24h throttle', async () => {
    registerWhoami('delta', { quick: true, quickLoggedIn: true });
    const statePath = await tempStatePath();
    await collectAuthRefresh({
      sites: 'delta',
      statePath,
      now: new Date('2026-06-06T12:00:00.000Z'),
    });
    executeCommandMock.mockClear();

    const rows = await collectAuthRefresh({
      sites: 'delta',
      all: true,
      statePath,
      now: new Date('2026-06-07T11:59:00.000Z'),
    });

    expect(rows[0]?.status).toBe('touched');
    expect(rows[0]?.last_touched_at).toBe('2026-06-07T11:59:00.000Z');
    expect(executeCommandMock).toHaveBeenCalledTimes(1);
  });

  it('does not throttle not_logged_in results', async () => {
    registerWhoami('epsilon', { quick: true, quickLoggedIn: true });
    const statePath = await tempStatePath();
    executeCommandMock.mockRejectedValueOnce(new AuthRequiredError('epsilon.example.com'));

    const rows = await collectAuthRefresh({
      sites: 'epsilon',
      statePath,
      now: new Date('2026-06-06T12:00:00.000Z'),
    });

    expect(rows).toEqual([
      { site: 'epsilon', status: 'not_logged_in', last_touched_at: '', next_refresh_at: '', error: '' },
    ]);
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    expect(state.sites.epsilon).toMatchObject({
      last_attempt_at: '2026-06-06T12:00:00.000Z',
      last_status: 'not_logged_in',
    });
    expect(state.sites.epsilon.last_touched_at).toBeUndefined();

    executeCommandMock.mockClear();
    await collectAuthRefresh({
      sites: 'epsilon',
      statePath,
      now: new Date('2026-06-06T12:01:00.000Z'),
    });
    expect(executeCommandMock).toHaveBeenCalledTimes(1);
  });

  it('does not update last_touched_at for generic errors', async () => {
    registerWhoami('zeta', { quick: true, quickLoggedIn: true });
    const statePath = await tempStatePath();
    executeCommandMock.mockRejectedValueOnce(new Error('network down'));

    const rows = await collectAuthRefresh({
      sites: 'zeta',
      statePath,
      now: new Date('2026-06-06T12:00:00.000Z'),
    });

    expect(rows).toEqual([
      { site: 'zeta', status: 'error', last_touched_at: '', next_refresh_at: '', error: 'network down' },
    ]);
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    expect(state.sites.zeta).toMatchObject({
      last_attempt_at: '2026-06-06T12:00:00.000Z',
      last_status: 'error',
    });
    expect(state.sites.zeta.last_touched_at).toBeUndefined();
  });

  it('marks sites without quickCheck or refresh hook as unsupported instead of running DOM whoami fallback', async () => {
    registerWhoami('eta');
    const statePath = await tempStatePath();

    const rows = await collectAuthRefresh({
      sites: 'eta',
      statePath,
      now: new Date('2026-06-06T12:00:00.000Z'),
    });

    expect(rows).toEqual([
      {
        site: 'eta',
        status: 'unsupported',
        last_touched_at: '',
        next_refresh_at: '',
        error: 'refresh probe is not available for this site',
      },
    ]);
    expect(executeCommandMock).not.toHaveBeenCalled();
  });
});

describe('auth refresh scheduled collection', () => {
  it('does nothing when the App auth refresh config is disabled', async () => {
    registerWhoami('alpha', { quick: true, quickLoggedIn: true });
    const { configPath, runStatePath } = await tempAppAuthRefreshPaths();
    await writeJson(configPath, { enabled: false, scheduleTime: '03:00', perSiteEnabled: {} });

    const rows = await collectAuthRefreshScheduled({
      configPath,
      runStatePath,
      now: new Date('2026-06-06T04:00:00.000Z'),
    });

    expect(rows).toEqual([]);
    expect(executeCommandMock).not.toHaveBeenCalled();
    const state = JSON.parse(await readFile(runStatePath, 'utf8'));
    expect(state.lastFullRun).toBe('@1780718400');
    expect(state.lastFullRunSummary).toBe('No due sites');
  });

  it('runs due enabled sites and writes App-shaped run state timestamps', async () => {
    registerWhoami('alpha', { quick: true, quickLoggedIn: true });
    const { configPath, runStatePath } = await tempAppAuthRefreshPaths();
    await writeJson(configPath, { enabled: true, scheduleTime: '03:00', perSiteEnabled: {} });
    const now = new Date('2026-06-06T04:00:00.000Z');

    const rows = await collectAuthRefreshScheduled({
      sites: 'alpha',
      configPath,
      runStatePath,
      now,
      jitterMinutes: 1,
    });

    expect(rows).toEqual([
      {
        site: 'alpha',
        status: 'touched',
        lastAttempt: '@1780718400',
        lastTouched: '@1780718400',
        message: '',
      },
    ]);
    expect(executeCommandMock).toHaveBeenCalledTimes(1);
    const state = JSON.parse(await readFile(runStatePath, 'utf8'));
    expect(state).toMatchObject({
      schemaVersion: 1,
      lastFullRun: '@1780718400',
      lastFullRunSummary: '1 touched',
      perSite: {
        alpha: {
          lastAttempt: '@1780718400',
          lastTouched: '@1780718400',
          status: 'touched',
          consecutiveFailures: 0,
        },
      },
    });
  });

  it('skips sites already attempted in the current due window', async () => {
    registerWhoami('beta', { quick: true, quickLoggedIn: true });
    const { configPath, runStatePath } = await tempAppAuthRefreshPaths();
    await writeJson(configPath, { enabled: true, scheduleTime: '03:00', perSiteEnabled: {} });
    await writeJson(runStatePath, {
      schemaVersion: 1,
      perSite: {
        beta: { lastAttempt: '@1780718400', status: 'touched', consecutiveFailures: 0 },
      },
    });

    const rows = await collectAuthRefreshScheduled({
      sites: 'beta',
      configPath,
      runStatePath,
      now: new Date('2026-06-06T04:00:00.000Z'),
      jitterMinutes: 1,
    });

    expect(rows).toEqual([]);
    expect(executeCommandMock).not.toHaveBeenCalled();
  });

  it('honors per-site disabled overrides and failure backoff', async () => {
    registerWhoami('alpha', { quick: true, quickLoggedIn: true });
    registerWhoami('beta', { quick: true, quickLoggedIn: true });
    registerWhoami('gamma', { quick: true, quickLoggedIn: true });
    const { configPath, runStatePath } = await tempAppAuthRefreshPaths();
    await writeJson(configPath, {
      enabled: true,
      scheduleTime: '03:00',
      perSiteEnabled: { beta: false },
    });
    await writeJson(runStatePath, {
      schemaVersion: 1,
      perSite: {
        gamma: { status: 'error', consecutiveFailures: 3, lastAttempt: '@1780632000' },
      },
    });

    const rows = await collectAuthRefreshScheduled({
      configPath,
      runStatePath,
      now: new Date('2026-06-06T04:00:00.000Z'),
      jitterMinutes: 1,
    });

    expect(rows.map(row => row.site)).toEqual(['alpha']);
    expect(executeCommandMock).toHaveBeenCalledTimes(1);
  });

  it('records unsupported sites in App run state', async () => {
    registerWhoami('eta');
    const { configPath, runStatePath } = await tempAppAuthRefreshPaths();
    await writeJson(configPath, { enabled: true, scheduleTime: '03:00', perSiteEnabled: {} });

    const rows = await collectAuthRefreshScheduled({
      sites: 'eta',
      configPath,
      runStatePath,
      now: new Date('2026-06-06T04:00:00.000Z'),
      jitterMinutes: 1,
    });

    expect(rows).toEqual([
      {
        site: 'eta',
        status: 'unsupported',
        lastAttempt: '@1780718400',
        lastTouched: '',
        message: 'refresh probe is not available for this site',
      },
    ]);
    const state = JSON.parse(await readFile(runStatePath, 'utf8'));
    expect(state.perSite.eta).toMatchObject({
      lastAttempt: '@1780718400',
      status: 'unsupported',
      message: 'refresh probe is not available for this site',
      consecutiveFailures: 0,
    });
  });

  it('allows zero jitter for deterministic scheduler debugging', async () => {
    registerWhoami('theta', { quick: true, quickLoggedIn: true });
    const { configPath, runStatePath } = await tempAppAuthRefreshPaths();
    await writeJson(configPath, { enabled: true, scheduleTime: '03:00', perSiteEnabled: {} });

    const rows = await collectAuthRefreshScheduled({
      sites: 'theta',
      configPath,
      runStatePath,
      now: new Date('2026-06-06T03:00:00.000Z'),
      jitterMinutes: 0,
    });

    expect(rows[0]?.status).toBe('touched');
  });
});
