import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CliCommand } from './registry.js';
import { coerceAndValidateArgs, executeCommand, prepareCommandArgs } from './execution.js';
import { ArgumentError, TimeoutError, toEnvelope } from './errors.js';
import { cli, Strategy } from './registry.js';
import { withTimeoutMs } from './runtime.js';
import * as runtime from './runtime.js';
import * as capRouting from './capabilityRouting.js';
import * as daemonClient from './browser/daemon-client.js';
import { BrowserCommandError } from './browser/daemon-client.js';
import { clearAllHooks, onBeforeExecute } from './hooks.js';

afterEach(() => {
  clearAllHooks();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('coerceAndValidateArgs', () => {
  it('rejects fractional values for integer arguments', () => {
    const args = [{ name: 'limit', type: 'int' as const, help: 'Result limit' }];

    expect(() => coerceAndValidateArgs(args, { limit: '1.5' })).toThrow(ArgumentError);
  });

  it('rejects non-finite values for numeric arguments', () => {
    const integerArgs = [{ name: 'limit', type: 'int' as const, help: 'Result limit' }];
    const numberArgs = [{ name: 'threshold', type: 'number' as const, help: 'Threshold' }];

    expect(() => coerceAndValidateArgs(integerArgs, { limit: 'Infinity' })).toThrow(ArgumentError);
    expect(() => coerceAndValidateArgs(numberArgs, { threshold: '-Infinity' })).toThrow(ArgumentError);
  });
});

describe('executeCommand — non-browser timeout', () => {
  it('applies the user --timeout arg as the ceiling for non-browser commands', async () => {
    const runWithTimeoutSpy = vi.spyOn(runtime, 'runWithTimeout');
    const cmd = cli({
      site: 'test-execution',
      name: 'non-browser-timeout', access: 'read',
      description: 'test non-browser --timeout enforcement',
      browser: false,
      strategy: Strategy.PUBLIC,
      args: [
        { name: 'timeout', type: 'int', required: false, default: 5, help: 'Max seconds' },
      ],
      func: async () => [{ ok: true }],
    });

    await executeCommand(cmd, {});

    expect(runWithTimeoutSpy).toHaveBeenCalledTimes(1);
    // Ceiling = user-supplied/default timeout + 30s padding (adapter return room).
    expect(runWithTimeoutSpy.mock.calls[0]?.[1]).toMatchObject({
      timeout: 35,
      label: 'test-execution/non-browser-timeout',
    });
    vi.restoreAllMocks();
  });

  it('fires a TimeoutError when the inner adapter exceeds the --timeout ceiling', async () => {
    const cmd = cli({
      site: 'test-execution',
      name: 'non-browser-timeout-fires', access: 'read',
      description: 'test that the ceiling actually cancels the adapter',
      browser: false,
      strategy: Strategy.PUBLIC,
      args: [
        { name: 'timeout', type: 'int', required: false, default: 1, help: 'Max seconds' },
      ],
      func: () => new Promise(() => {}),
    });

    // Spy on runWithTimeout to intercept and pass a tiny ceiling so the test
    // doesn't have to wait the real (1+30)s. We still verify the TimeoutError
    // surface — code, label, hint — that users see.
    vi.spyOn(runtime, 'runWithTimeout').mockImplementation(async (promise, opts) => {
      return runtime.withTimeoutMs(
        promise as Promise<unknown>,
        50,
        () => new TimeoutError(opts.label ?? 'op', opts.timeout, opts.hint),
      ) as never;
    });

    const error = await executeCommand(cmd, {}).catch((err) => err);

    expect(error).toBeInstanceOf(TimeoutError);
    expect(error).toMatchObject({
      code: 'TIMEOUT',
      hint: 'Pass a higher --timeout value (currently 1s)',
    });
    vi.restoreAllMocks();
  });

  it('runs non-browser commands without a ceiling when no --timeout arg is declared', async () => {
    const runWithTimeoutSpy = vi.spyOn(runtime, 'runWithTimeout');
    const cmd = cli({
      site: 'test-execution',
      name: 'non-browser-no-timeout', access: 'read',
      description: 'test that omitting --timeout means no ceiling',
      browser: false,
      strategy: Strategy.PUBLIC,
      func: async () => [{ ok: true }],
    });

    await executeCommand(cmd, {});

    expect(runWithTimeoutSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('rejects invalid --timeout values instead of silently disabling the non-browser ceiling', async () => {
    const runWithTimeoutSpy = vi.spyOn(runtime, 'runWithTimeout');
    const cmd = cli({
      site: 'test-execution',
      name: 'non-browser-invalid-timeout', access: 'read',
      description: 'test invalid --timeout fails upfront',
      browser: false,
      strategy: Strategy.PUBLIC,
      args: [
        { name: 'timeout', type: 'int', required: false, default: 5, help: 'Max seconds' },
      ],
      func: async () => [{ ok: true }],
    });

    await expect(executeCommand(cmd, { timeout: 0 })).rejects.toBeInstanceOf(ArgumentError);
    await expect(executeCommand(cmd, { timeout: -1 })).rejects.toBeInstanceOf(ArgumentError);
    await expect(executeCommand(cmd, { timeout: 1.5 })).rejects.toBeInstanceOf(ArgumentError);
    expect(runWithTimeoutSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('applies the user --timeout arg as the ceiling for browser commands (with +30s padding)', async () => {
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const mockPage = { closeWindow } as any;

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => fn(mockPage));
    const runWithTimeoutSpy = vi.spyOn(runtime, 'runWithTimeout');

    const cmd = cli({
      site: 'test-execution',
      name: 'browser-with-timeout', access: 'read',
      description: 'test browser --timeout enforcement',
      browser: true,
      strategy: Strategy.PUBLIC,
      args: [
        { name: 'timeout', type: 'int', required: false, default: 5, help: 'Max seconds' },
      ],
      func: async () => [{ ok: true }],
    });

    await executeCommand(cmd, {});

    expect(runWithTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(runWithTimeoutSpy.mock.calls[0]?.[1]).toMatchObject({
      timeout: 35,
      label: 'test-execution/browser-with-timeout',
    });
    vi.restoreAllMocks();
  });

  it('falls back to DEFAULT_BROWSER_COMMAND_TIMEOUT for browser commands without a --timeout arg', async () => {
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const mockPage = { closeWindow } as any;

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => fn(mockPage));
    const runWithTimeoutSpy = vi.spyOn(runtime, 'runWithTimeout');

    const cmd = cli({
      site: 'test-execution',
      name: 'browser-no-timeout', access: 'read',
      description: 'test browser fallback to global default',
      browser: true,
      strategy: Strategy.PUBLIC,
      func: async () => [{ ok: true }],
    });

    await executeCommand(cmd, {});

    expect(runWithTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(runWithTimeoutSpy.mock.calls[0]?.[1]).toMatchObject({
      timeout: runtime.DEFAULT_BROWSER_COMMAND_TIMEOUT,
      label: 'test-execution/browser-no-timeout',
    });
    vi.restoreAllMocks();
  });

  it('reuses a persistent site browser session and keeps the tab lease open', async () => {
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const mockPage = { closeWindow } as any;
    const sessionOpts: Array<{ session?: string; idleTimeout?: number; windowMode?: string; siteSession?: string }> = [];

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn, opts) => {
      sessionOpts.push(opts ?? {});
      return fn(mockPage);
    });

    const cmd = cli({
      site: 'test-execution',
      name: 'site-session-persistent', access: 'read',
      description: 'test persistent site session',
      browser: true,
      strategy: Strategy.PUBLIC,
      siteSession: 'persistent',
      func: async () => [{ ok: true }],
    });

    await executeCommand(cmd, {});
    await executeCommand(cmd, {}, false, { keepTab: 'false' });

    expect(sessionOpts).toHaveLength(2);
    expect(sessionOpts[0]).toMatchObject({ session: 'site:test-execution', windowMode: 'background', siteSession: 'persistent' });
    expect(sessionOpts[1]).toMatchObject({ session: 'site:test-execution', windowMode: 'background', siteSession: 'persistent' });
    expect(sessionOpts[0]?.idleTimeout).toBeUndefined();
    expect(sessionOpts[1]?.idleTimeout).toBeUndefined();
    expect(closeWindow).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('keeps default browser commands on one-shot adapter sessions', async () => {
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const mockPage = { closeWindow } as any;
    const sessionOpts: Array<{ session?: string; idleTimeout?: number; windowMode?: string }> = [];

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn, opts) => {
      sessionOpts.push(opts ?? {});
      return fn(mockPage);
    });

    const cmd = cli({
      site: 'test-execution',
      name: 'site-session-default', access: 'read',
      description: 'test default one-shot browser session',
      browser: true,
      strategy: Strategy.PUBLIC,
      func: async () => [{ ok: true }],
    });

    await executeCommand(cmd, {});
    await executeCommand(cmd, {});

    expect(sessionOpts).toHaveLength(2);
    expect(sessionOpts[0]?.session).toMatch(/^site:test-execution:/);
    expect(sessionOpts[1]?.session).toMatch(/^site:test-execution:/);
    expect(sessionOpts[0]?.session).not.toBe(sessionOpts[1]?.session);
    expect(sessionOpts[0]?.idleTimeout).toBeUndefined();
    expect(sessionOpts[1]?.idleTimeout).toBeUndefined();
    expect(sessionOpts[0]?.windowMode).toBe('background');
    expect(sessionOpts[1]?.windowMode).toBe('background');
    expect(closeWindow).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });

  it.each([
    { label: 'lets ephemeral env override persistent metadata', env: 'ephemeral', metadata: 'persistent', explicit: undefined, expected: 'ephemeral' },
    { label: 'lets persistent env override ephemeral metadata', env: 'persistent', metadata: 'ephemeral', explicit: undefined, expected: 'persistent' },
    { label: 'lets ephemeral flag override persistent env', env: 'persistent', metadata: 'persistent', explicit: 'ephemeral', expected: 'ephemeral' },
    { label: 'lets persistent flag override ephemeral env', env: 'ephemeral', metadata: 'ephemeral', explicit: 'persistent', expected: 'persistent' },
    { label: 'does not parse a shadowed invalid env', env: '', metadata: 'ephemeral', explicit: 'persistent', expected: 'persistent' },
  ] as const)('$label', async ({ env, metadata, explicit, expected }) => {
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const mockPage = { closeWindow } as any;
    const sessionOpts: Array<{ session?: string; siteSession?: string }> = [];

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn, opts) => {
      sessionOpts.push(opts ?? {});
      return fn(mockPage);
    });

    vi.stubEnv('OPENCLI_SITE_SESSION', env);
    const cmd = cli({
      site: 'test-execution',
      name: 'site-session-precedence', access: 'read',
      description: 'test site-session precedence',
      browser: true,
      strategy: Strategy.PUBLIC,
      siteSession: metadata,
      func: async () => [{ ok: true }],
    });

    await executeCommand(cmd, {}, false, explicit === undefined ? {} : { siteSession: explicit });

    expect(sessionOpts).toHaveLength(1);
    expect(sessionOpts[0]?.siteSession).toBe(expected);
    if (expected === 'persistent') {
      expect(sessionOpts[0]?.session).toBe('site:test-execution');
      expect(closeWindow).not.toHaveBeenCalled();
    } else {
      expect(sessionOpts[0]?.session).toMatch(/^site:test-execution:/);
      expect(closeWindow).toHaveBeenCalledTimes(1);
    }
  });

  it.each(['', ' ', 'Persistent'])('rejects invalid OPENCLI_SITE_SESSION=%j before hooks or browser setup', async (env) => {
    const beforeHook = vi.fn();
    const adapter = vi.fn(async () => [{ ok: true }]);
    onBeforeExecute(beforeHook);
    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    const browserSessionSpy = vi.spyOn(runtime, 'browserSession');

    vi.stubEnv('OPENCLI_SITE_SESSION', env);
    const cmd = cli({
      site: 'test-execution',
      name: 'site-session-invalid-env', access: 'read',
      description: 'test invalid site-session env fails before side effects',
      browser: true,
      strategy: Strategy.PUBLIC,
      navigateBefore: 'https://example.com/',
      func: adapter,
    });

    await expect(executeCommand(cmd, {})).rejects.toMatchObject({ code: 'ARGUMENT' });
    expect(beforeHook).not.toHaveBeenCalled();
    expect(browserSessionSpy).not.toHaveBeenCalled();
    expect(adapter).not.toHaveBeenCalled();
  });

  it('does not apply OPENCLI_SITE_SESSION to non-browser commands', async () => {
    vi.stubEnv('OPENCLI_SITE_SESSION', 'invalid');
    const cmd = cli({
      site: 'test-execution',
      name: 'site-session-node-only', access: 'read',
      description: 'test browser env does not poison node-only commands',
      browser: false,
      strategy: Strategy.PUBLIC,
      func: async () => [{ ok: true }],
    });

    await expect(executeCommand(cmd, {})).resolves.toEqual([{ ok: true }]);
  });

  it('skips repeated domain pre-navigation for persistent site sessions', async () => {
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const goto = vi.fn().mockResolvedValue(undefined);
    const mockPage = {
      closeWindow,
      goto,
      getCurrentUrl: vi.fn().mockResolvedValue('https://grok.com/chat/abc'),
    } as any;

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => fn(mockPage));

    const cmd = cli({
      site: 'test-execution',
      name: 'site-session-skip-prenav', access: 'read',
      description: 'test reused same-domain tabs do not reset conversation state',
      browser: true,
      strategy: Strategy.COOKIE,
      domain: 'grok.com',
      siteSession: 'persistent',
      func: async () => [{ ok: true }],
    });

    await executeCommand(cmd, {});

    expect(goto).not.toHaveBeenCalled();
    expect(closeWindow).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('keeps explicit path pre-navigation for persistent site sessions', async () => {
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const goto = vi.fn().mockResolvedValue(undefined);
    const mockPage = {
      closeWindow,
      goto,
      getCurrentUrl: vi.fn().mockResolvedValue('https://example.com/other'),
    } as any;

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => fn(mockPage));

    const cmd = cli({
      site: 'test-execution',
      name: 'site-session-path-prenav', access: 'read',
      description: 'test explicit path pre-navigation still runs',
      browser: true,
      strategy: Strategy.COOKIE,
      domain: 'example.com',
      navigateBefore: 'https://example.com/dashboard',
      siteSession: 'persistent',
      func: async () => [{ ok: true }],
    });

    await executeCommand(cmd, {});

    expect(goto).toHaveBeenCalledWith('https://example.com/dashboard');
    expect(closeWindow).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  // 2026-09-27: one rejected pre-navigation failed `linkedin connections`, and the daily social
  // run sent no general invites. The adapters already retried; the pre-navigation did not.
  it('retries a rejected pre-navigation and then runs the adapter', async () => {
    const goto = vi.fn()
      .mockRejectedValueOnce(new Error('Navigation rejected.'))
      .mockResolvedValueOnce(undefined);
    const newTab = vi.fn();
    const mockPage = { goto, newTab, setActivePage: vi.fn() } as any;

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => fn(mockPage));

    const func = vi.fn(async () => [{ ok: true }]);
    const cmd = cli({
      site: 'test-execution',
      name: 'prenav-rejected-once', access: 'read',
      description: 'test a rejected pre-navigation is retried',
      browser: true,
      strategy: Strategy.COOKIE,
      domain: 'example.com',
      func,
    });

    await expect(executeCommand(cmd, {})).resolves.toEqual([{ ok: true }]);

    expect(goto).toHaveBeenCalledTimes(2);
    expect(goto).toHaveBeenLastCalledWith('https://example.com');
    expect(newTab).not.toHaveBeenCalled();
    expect(func).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it('moves a twice-rejected pre-navigation to a new tab and runs the adapter there', async () => {
    const goto = vi.fn().mockRejectedValue(new Error('Navigation rejected.'));
    const newTab = vi.fn().mockResolvedValue('p2');
    const setActivePage = vi.fn();
    const evaluate = vi.fn().mockResolvedValue({ href: 'https://example.com/', ready: 'complete' });
    const mockPage = { goto, newTab, setActivePage, evaluate } as any;

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => fn(mockPage));

    const func = vi.fn(async () => [{ ok: true }]);
    const cmd = cli({
      site: 'test-execution',
      name: 'prenav-rejected-twice', access: 'read',
      description: 'test a twice-rejected pre-navigation falls back to a new tab',
      browser: true,
      strategy: Strategy.COOKIE,
      domain: 'example.com',
      func,
    });

    await expect(executeCommand(cmd, {})).resolves.toEqual([{ ok: true }]);

    expect(goto).toHaveBeenCalledTimes(2);
    expect(newTab).toHaveBeenCalledWith('https://example.com', { replace: true });
    expect(setActivePage).toHaveBeenCalledWith('p2');
    expect(func).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it('fails a pre-navigation that stays rejected, and never runs the adapter', async () => {
    const goto = vi.fn().mockRejectedValue(new Error('Navigation rejected.'));
    const mockPage = { goto } as any;

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => fn(mockPage));

    const func = vi.fn(async () => [{ ok: true }]);
    const cmd = cli({
      site: 'test-execution',
      name: 'prenav-rejected-for-good', access: 'read',
      description: 'test a pre-navigation with no fallback still fails loudly',
      browser: true,
      strategy: Strategy.COOKIE,
      domain: 'example.com',
      func,
    });

    await expect(executeCommand(cmd, {})).rejects.toThrow(
      'Pre-navigation to https://example.com failed: Navigation rejected.',
    );

    expect(goto).toHaveBeenCalledTimes(2);
    expect(func).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('respects navigateBefore=false so adapter range validation fails before browser navigation', async () => {
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const goto = vi.fn().mockResolvedValue(undefined);
    const mockPage = {
      closeWindow,
      goto,
      getCurrentUrl: vi.fn().mockResolvedValue('about:blank'),
    } as any;

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => fn(mockPage));

    const cmd = cli({
      site: 'test-execution',
      name: 'browser-invalid-limit-no-prenav', access: 'read',
      description: 'test adapter range validation can fail before pre-nav',
      browser: true,
      strategy: Strategy.COOKIE,
      domain: 'www.facebook.com',
      navigateBefore: false,
      args: [
        { name: 'limit', type: 'int', required: false, default: 15, help: 'Limit' },
      ],
      func: async (_page, args) => {
        const limit = Number(args.limit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
          throw new ArgumentError('--limit must be a positive integer in [1, 100]');
        }
        return [{ ok: true }];
      },
    });

    await expect(executeCommand(cmd, { limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
    expect(goto).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('rejects invalid --timeout values instead of falling back to the browser default', async () => {
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const mockPage = { closeWindow } as any;

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => fn(mockPage));
    const runWithTimeoutSpy = vi.spyOn(runtime, 'runWithTimeout');

    const cmd = cli({
      site: 'test-execution',
      name: 'browser-invalid-timeout', access: 'read',
      description: 'test invalid browser --timeout fails upfront',
      browser: true,
      strategy: Strategy.PUBLIC,
      args: [
        { name: 'timeout', type: 'int', required: false, default: 5, help: 'Max seconds' },
      ],
      func: async () => [{ ok: true }],
    });

    await expect(executeCommand(cmd, { timeout: 0 })).rejects.toBeInstanceOf(ArgumentError);
    await expect(executeCommand(cmd, { timeout: -1 })).rejects.toBeInstanceOf(ArgumentError);
    await expect(executeCommand(cmd, { timeout: 1.5 })).rejects.toBeInstanceOf(ArgumentError);
    expect(runWithTimeoutSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('rejects invalid browser --timeout before opening a session or pre-navigating', async () => {
    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    const browserSessionSpy = vi.spyOn(runtime, 'browserSession');

    const cmd = cli({
      site: 'test-execution',
      name: 'browser-invalid-timeout-prenav', access: 'read',
      description: 'test invalid browser --timeout fails before session setup',
      browser: true,
      strategy: Strategy.PUBLIC,
      navigateBefore: 'https://example.com/',
      args: [
        { name: 'timeout', type: 'int', required: false, default: 5, help: 'Max seconds' },
      ],
      func: async () => [{ ok: true }],
    });

    await expect(executeCommand(cmd, { timeout: 0 })).rejects.toBeInstanceOf(ArgumentError);
    expect(browserSessionSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('lets env ephemeral override persistent metadata and closes the window on failure', async () => {
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const mockPage = { closeWindow } as any;

    // Mock shouldUseBrowserSession to return true
    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);

    // Mock browserSession to invoke the callback with our mock page
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => {
      return fn(mockPage);
    });

    const cmd = cli({
      site: 'test-execution',
      name: 'browser-close-on-error', access: 'read',
      description: 'test env ephemeral closeWindow on failure',
      browser: true,
      strategy: Strategy.PUBLIC,
      siteSession: 'persistent',
      func: async () => { throw new Error('adapter failure'); },
    });

    vi.stubEnv('OPENCLI_SITE_SESSION', 'ephemeral');
    await expect(executeCommand(cmd, {})).rejects.toThrow('adapter failure');
    expect(closeWindow).toHaveBeenCalledTimes(1);
  });

  it('skips closeWindow when --keep-tab=true (success path)', async () => {
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const mockPage = { closeWindow } as any;

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => fn(mockPage));

    try {
      const cmd = cli({
        site: 'test-execution',
        name: 'browser-keep-tab-success', access: 'read',
        description: 'test closeWindow skipped with --keep-tab on success',
        browser: true,
        strategy: Strategy.PUBLIC,
        func: async () => [{ ok: true }],
      });

      await executeCommand(cmd, {}, false, { keepTab: 'true' });
      expect(closeWindow).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('skips closeWindow when --keep-tab=true (failure path)', async () => {
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const mockPage = { closeWindow } as any;

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => fn(mockPage));

    try {
      const cmd = cli({
        site: 'test-execution',
        name: 'browser-keep-tab-failure', access: 'read',
        description: 'test closeWindow skipped with --keep-tab on failure',
        browser: true,
        strategy: Strategy.PUBLIC,
        func: async () => { throw new Error('adapter failure'); },
      });

      await expect(executeCommand(cmd, {}, false, { keepTab: 'true' })).rejects.toThrow('adapter failure');
      expect(closeWindow).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('lets browser common options override adapter window and keep-tab defaults', async () => {
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const mockPage = { closeWindow } as any;
    const sessionOpts: Array<{ windowMode?: string }> = [];

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn, opts) => {
      sessionOpts.push(opts ?? {});
      return fn(mockPage);
    });

    const cmd = cli({
      site: 'test-execution',
      name: 'browser-window-options', access: 'read',
      description: 'test browser common options',
      browser: true,
      strategy: Strategy.PUBLIC,
      func: async () => [{ ok: true }],
    });

    await executeCommand(cmd, {}, false, {
      windowMode: 'foreground',
      keepTab: 'true',
    });

    expect(sessionOpts[0]).toMatchObject({ windowMode: 'foreground' });
    expect(closeWindow).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('uses command defaultWindowMode when the user does not pass --window', async () => {
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const mockPage = { closeWindow } as any;
    const sessionOpts: Array<{ windowMode?: string }> = [];

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn, opts) => {
      sessionOpts.push(opts ?? {});
      return fn(mockPage);
    });

    const cmd = cli({
      site: 'test-execution',
      name: 'browser-default-window-mode', access: 'write',
      description: 'test command default window mode',
      browser: true,
      strategy: Strategy.PUBLIC,
      defaultWindowMode: 'foreground',
      func: async () => [{ ok: true }],
    });

    await executeCommand(cmd, {});

    expect(sessionOpts[0]).toMatchObject({ windowMode: 'foreground' });
    vi.restoreAllMocks();
  });

  it('does not re-run custom validation when args are already prepared', async () => {
    const validateArgs = vi.fn();
    const cmd: CliCommand = {
      site: 'test-execution',
      name: 'prepared-validation', access: 'read',
      description: 'test prepared validation path',
      browser: false,
      strategy: Strategy.PUBLIC,
      args: [],
      validateArgs,
      func: async () => [],
    };

    const kwargs = prepareCommandArgs(cmd, {});
    await executeCommand(cmd, kwargs, false, { prepared: true });

    expect(validateArgs).toHaveBeenCalledTimes(1);
  });

  it('exports a profile-scoped trace artifact on browser command failure when requested', async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-exec-trace-'));
    const prevConfigDir = process.env.OPENCLI_CONFIG_DIR;
    process.env.OPENCLI_CONFIG_DIR = baseDir;
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const mockPage = {
      closeWindow,
      startNetworkCapture: vi.fn().mockResolvedValue(true),
      readNetworkCapture: vi.fn().mockResolvedValue([
        {
          url: 'https://api.example.com/data?token=secret',
          method: 'GET',
          responseStatus: 500,
          responseContentType: 'application/json',
          responsePreview: JSON.stringify({ password: 'secret', ok: false }),
          requestHeaders: { authorization: 'Bearer secret' },
          timestamp: Date.now(),
        },
      ]),
      consoleMessages: vi.fn().mockResolvedValue([{ type: 'error', text: 'boom password=secret', timestamp: Date.now() }]),
      snapshot: vi.fn().mockResolvedValue({ html: '<input type="password" value="secret">' }),
      screenshot: vi.fn().mockResolvedValue(Buffer.from('png').toString('base64')),
      getCurrentUrl: vi.fn().mockResolvedValue('https://api.example.com/app'),
      getActivePage: vi.fn().mockReturnValue('tab-1'),
    } as any;

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => fn(mockPage));

    try {
      const cmd = cli({
        site: 'test-execution',
        name: 'browser-trace-failure', access: 'read',
        description: 'test trace export',
        browser: true,
        strategy: Strategy.PUBLIC,
        func: async () => { throw new Error('adapter failure'); },
      });

      const thrown = await executeCommand(cmd, {}, false, { trace: 'retain-on-failure' }).catch((err) => err);
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toContain('adapter failure');

      const tracesRoot = path.join(baseDir, 'profiles', 'default', 'traces');
      const traceId = fs.readdirSync(tracesRoot)[0];
      const traceDir = path.join(tracesRoot, traceId);
      expect(fs.existsSync(path.join(traceDir, 'trace.jsonl'))).toBe(true);
      expect(fs.existsSync(path.join(traceDir, 'receipt.json'))).toBe(true);
      const trace = fs.readFileSync(path.join(traceDir, 'trace.jsonl'), 'utf-8');
      expect(trace).toContain('token=[REDACTED]');
      expect(trace).toContain('"authorization":"[REDACTED]"');
      expect(trace).not.toContain('password=secret');
      expect(stderrSpy.mock.calls.flat().join('\n')).not.toContain('___OPENCLI_TRACE___');

      expect(toEnvelope(thrown).trace).toMatchObject({
        traceId,
        dir: traceDir,
        summaryPath: path.join(traceDir, 'summary.md'),
        receiptPath: path.join(traceDir, 'receipt.json'),
        status: 'failure',
      });
      expect(closeWindow).toHaveBeenCalledTimes(1);
    } finally {
      if (prevConfigDir === undefined) delete process.env.OPENCLI_CONFIG_DIR;
      else process.env.OPENCLI_CONFIG_DIR = prevConfigDir;
      stderrSpy.mockRestore();
      fs.rmSync(baseDir, { recursive: true, force: true });
      vi.restoreAllMocks();
    }
  });

  it('exports a trace receipt on browser command success when trace is on', async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-exec-trace-success-'));
    const prevConfigDir = process.env.OPENCLI_CONFIG_DIR;
    process.env.OPENCLI_CONFIG_DIR = baseDir;
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const onTraceExport = vi.fn();
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const mockPage = {
      closeWindow,
      startNetworkCapture: vi.fn().mockResolvedValue(true),
      readNetworkCapture: vi.fn().mockResolvedValue([]),
      consoleMessages: vi.fn().mockResolvedValue([]),
      snapshot: vi.fn().mockResolvedValue('snapshot'),
      screenshot: vi.fn().mockResolvedValue(Buffer.from('png').toString('base64')),
      getCurrentUrl: vi.fn().mockResolvedValue('https://example.com'),
      getActivePage: vi.fn().mockReturnValue('tab-1'),
    } as any;

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => fn(mockPage));

    try {
      const cmd = cli({
        site: 'test-execution',
        name: 'browser-trace-success', access: 'read',
        description: 'test trace export on success',
        browser: true,
        strategy: Strategy.PUBLIC,
        func: async () => [{ ok: true }],
      });

      await expect(executeCommand(cmd, {}, false, { trace: 'on', onTraceExport })).resolves.toEqual([{ ok: true }]);

      const stderr = stderrSpy.mock.calls.flat().join('\n');
      expect(stderr).toContain('OpenCLI trace artifact:');
      const tracesRoot = path.join(baseDir, 'profiles', 'default', 'traces');
      const traceId = fs.readdirSync(tracesRoot)[0];
      const receipt = JSON.parse(fs.readFileSync(path.join(tracesRoot, traceId, 'receipt.json'), 'utf-8'));
      expect(receipt.status).toBe('success');
      expect(receipt.traceDir).toContain(path.join(baseDir, 'profiles', 'default', 'traces'));
      expect(receipt.scope).toMatchObject({
        site: 'test-execution',
        command: 'test-execution/browser-trace-success',
      });
      expect(receipt.error).toBeUndefined();
      expect(onTraceExport).toHaveBeenCalledWith(expect.objectContaining({
        traceId,
        receipt: expect.objectContaining({ status: 'success' }),
      }));
      expect(closeWindow).toHaveBeenCalledTimes(1);
    } finally {
      if (prevConfigDir === undefined) delete process.env.OPENCLI_CONFIG_DIR;
      else process.env.OPENCLI_CONFIG_DIR = prevConfigDir;
      stderrSpy.mockRestore();
      fs.rmSync(baseDir, { recursive: true, force: true });
      vi.restoreAllMocks();
    }
  });

  it('keeps the original adapter error when trace export fails', async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-exec-trace-fail-'));
    const blockedPath = path.join(baseDir, 'not-a-dir');
    fs.writeFileSync(blockedPath, 'file');
    const prevConfigDir = process.env.OPENCLI_CONFIG_DIR;
    process.env.OPENCLI_CONFIG_DIR = blockedPath;
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const mockPage = {
      closeWindow: vi.fn().mockResolvedValue(undefined),
      startNetworkCapture: vi.fn().mockResolvedValue(true),
      readNetworkCapture: vi.fn().mockResolvedValue([]),
      consoleMessages: vi.fn().mockResolvedValue([]),
      snapshot: vi.fn().mockResolvedValue('snapshot'),
      screenshot: vi.fn().mockResolvedValue(Buffer.from('png').toString('base64')),
      getCurrentUrl: vi.fn().mockResolvedValue('https://example.com'),
      getActivePage: vi.fn().mockReturnValue('tab-1'),
    } as any;

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => fn(mockPage));

    try {
      const cmd = cli({
        site: 'test-execution',
        name: 'browser-trace-export-fails', access: 'read',
        description: 'test trace export failure handling',
        browser: true,
        strategy: Strategy.PUBLIC,
        func: async () => { throw new Error('adapter failure'); },
      });

      await expect(executeCommand(cmd, {}, false, { trace: 'retain-on-failure' })).rejects.toThrow('adapter failure');
      expect(stderrSpy.mock.calls.flat().join('\n')).toContain('[trace] Failed to export trace artifact');
    } finally {
      if (prevConfigDir === undefined) delete process.env.OPENCLI_CONFIG_DIR;
      else process.env.OPENCLI_CONFIG_DIR = prevConfigDir;
      stderrSpy.mockRestore();
      fs.rmSync(baseDir, { recursive: true, force: true });
      vi.restoreAllMocks();
    }
  });
});

describe('executeCommand — persistent write lease release', () => {
  function persistentWriteCmd(func: () => Promise<unknown>): CliCommand {
    return cli({
      site: 'test-execution',
      name: 'lease-write', access: 'write',
      description: 'test persistent write lease release',
      browser: true,
      strategy: Strategy.PUBLIC,
      siteSession: 'persistent',
      func,
    });
  }

  it('releases the lease after a successful persistent write', async () => {
    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => fn({} as any));
    const releaseSpy = vi.spyOn(daemonClient, 'releaseSiteSessionLease').mockResolvedValue(undefined);
    const runCtxSpy = vi.spyOn(daemonClient, 'setDaemonRunContext');

    await executeCommand(persistentWriteCmd(async () => [{ ok: true }]), {});

    expect(releaseSpy).toHaveBeenCalledTimes(1);
    expect(runCtxSpy).toHaveBeenLastCalledWith(null);
    vi.restoreAllMocks();
  });

  it('releases the lease after an ordinary persistent write failure', async () => {
    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => fn({} as any));
    const releaseSpy = vi.spyOn(daemonClient, 'releaseSiteSessionLease').mockResolvedValue(undefined);
    const runCtxSpy = vi.spyOn(daemonClient, 'setDaemonRunContext');

    const cmd = persistentWriteCmd(async () => { throw new BrowserCommandError('boom', 'attach_failed'); });
    await expect(executeCommand(cmd, {})).rejects.toThrow('boom');

    expect(releaseSpy).toHaveBeenCalledTimes(1);
    expect(runCtxSpy).toHaveBeenLastCalledWith(null);
    vi.restoreAllMocks();
  });

  it('does NOT release the lease after an unknown-outcome failure but still clears the run context', async () => {
    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => fn({} as any));
    const releaseSpy = vi.spyOn(daemonClient, 'releaseSiteSessionLease').mockResolvedValue(undefined);
    const runCtxSpy = vi.spyOn(daemonClient, 'setDaemonRunContext');

    // The browser-side command may still be running against the persistent tab,
    // so releasing now would let a manual rerun collide with it — the TTL must
    // reclaim the lease instead.
    const cmd = persistentWriteCmd(async () => { throw new BrowserCommandError('result unknown', 'command_result_unknown'); });
    await expect(executeCommand(cmd, {})).rejects.toThrow('result unknown');

    expect(releaseSpy).not.toHaveBeenCalled();
    expect(runCtxSpy).toHaveBeenLastCalledWith(null);
    vi.restoreAllMocks();
  });

  it('keeps the run identity bound through a CLI-layer timeout and cleans up when the adapter settles', async () => {
    vi.useFakeTimers();
    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => fn({} as any));
    const releaseSpy = vi.spyOn(daemonClient, 'releaseSiteSessionLease').mockResolvedValue(undefined);
    const runCtxSpy = vi.spyOn(daemonClient, 'setDaemonRunContext');
    const clearCtxSpy = vi.spyOn(daemonClient, 'clearDaemonRunContext');

    try {
      // runWithTimeout does not cancel the adapter promise, and the process
      // only exits when the event loop drains — the adapter can keep driving
      // the tab well past the lease TTL. The run context must stay bound (its
      // follow-up commands heartbeat the lease, blocking challengers) and the
      // lease released only when the adapter actually settles.
      let finishAdapter!: () => void;
      const adapterGate = new Promise<void>((resolve) => { finishAdapter = resolve; });
      const cmd = persistentWriteCmd(async () => { await adapterGate; return [{ ok: true }]; });
      const rejection = expect(executeCommand(cmd, {})).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
      await rejection;

      expect(releaseSpy).not.toHaveBeenCalled();
      expect(runCtxSpy).not.toHaveBeenCalledWith(null);
      expect(clearCtxSpy).not.toHaveBeenCalled();

      finishAdapter();
      await vi.advanceTimersByTimeAsync(0);

      const runId = runCtxSpy.mock.calls[0][0]?.runId;
      expect(clearCtxSpy).toHaveBeenCalledWith(runId);
      expect(releaseSpy).toHaveBeenCalledTimes(1);
      expect(releaseSpy).toHaveBeenCalledWith(expect.objectContaining({ runId }));
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
      daemonClient.setDaemonRunContext(null);
    }
  });

  it('skips the deferred release when a timed-out adapter ends with an unknown outcome', async () => {
    vi.useFakeTimers();
    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => fn({} as any));
    const releaseSpy = vi.spyOn(daemonClient, 'releaseSiteSessionLease').mockResolvedValue(undefined);
    const runCtxSpy = vi.spyOn(daemonClient, 'setDaemonRunContext');
    const clearCtxSpy = vi.spyOn(daemonClient, 'clearDaemonRunContext');

    try {
      // Same rule as the immediate path: if the zombie's last browser command
      // ends result-unknown, the browser side may still be busy — the lease
      // must lapse via TTL, not an explicit release.
      let failAdapter!: (err: Error) => void;
      const adapterGate = new Promise<never>((_resolve, reject) => { failAdapter = reject; });
      const cmd = persistentWriteCmd(async () => adapterGate);
      const rejection = expect(executeCommand(cmd, {})).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
      await rejection;

      failAdapter(new BrowserCommandError('late result unknown', 'command_result_unknown'));
      await vi.advanceTimersByTimeAsync(0);

      const runId = runCtxSpy.mock.calls[0][0]?.runId;
      expect(clearCtxSpy).toHaveBeenCalledWith(runId);
      expect(releaseSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
      daemonClient.setDaemonRunContext(null);
    }
  });

  it('does NOT release the lease when pre-navigation fails with an unknown outcome', async () => {
    const mockPage = {
      goto: vi.fn().mockRejectedValue(new BrowserCommandError('navigate result unknown', 'command_result_unknown')),
    } as any;
    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => fn(mockPage));
    const releaseSpy = vi.spyOn(daemonClient, 'releaseSiteSessionLease').mockResolvedValue(undefined);
    const runCtxSpy = vi.spyOn(daemonClient, 'setDaemonRunContext');

    // The pre-nav wrapper must keep the original error on the cause chain so
    // the release decision still sees the unknown outcome.
    const cmd = cli({
      site: 'test-execution',
      name: 'lease-prenav-unknown', access: 'write',
      description: 'test pre-nav unknown outcome keeps the lease',
      browser: true,
      strategy: Strategy.PUBLIC,
      siteSession: 'persistent',
      navigateBefore: 'https://example.com/inbox',
      func: async () => [{ ok: true }],
    });
    await expect(executeCommand(cmd, {})).rejects.toThrow('Pre-navigation to https://example.com/inbox failed');

    expect(mockPage.goto).toHaveBeenCalledWith('https://example.com/inbox');
    expect(releaseSpy).not.toHaveBeenCalled();
    expect(runCtxSpy).toHaveBeenLastCalledWith(null);
    vi.restoreAllMocks();
  });
});

describe('executeCommand — site slot pool (OPENCLI_SITE_SLOTS)', () => {
  function pooledCmd(access: 'read' | 'write', func: () => Promise<unknown> = async () => [{ ok: true }]): CliCommand {
    return cli({
      site: 'test-slots',
      name: `slot-${access}`, access,
      description: 'test site slot pool',
      browser: true,
      strategy: Strategy.PUBLIC,
      func,
    });
  }

  function stubBrowser() {
    const sessionOpts: Array<{ session?: string; siteSession?: string }> = [];
    const calls: string[] = [];
    let listed: Array<{ page?: string; active?: boolean }> = [{ page: 'TARGET-1', active: false }];
    const page = {
      closeWindow: vi.fn().mockResolvedValue(undefined),
      tabs: vi.fn(async () => { calls.push('tabs'); return listed; }),
      selectTab: vi.fn(async (t: string) => { calls.push(`select:${t}`); }),
    };
    const setListed = (tabs: typeof listed) => { listed = tabs; };
    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn, opts) => {
      sessionOpts.push(opts ?? {});
      return fn(page as any);
    });
    const acquireSpy = vi.spyOn(daemonClient, 'acquireSiteSlot').mockResolvedValue({ session: 'site:test-slots#1', slot: 1, waitedMs: 0 });
    const releaseSpy = vi.spyOn(daemonClient, 'releaseSiteSessionLease').mockResolvedValue(undefined);
    const runCtxSpy = vi.spyOn(daemonClient, 'setDaemonRunContext');
    return { sessionOpts, acquireSpy, releaseSpy, runCtxSpy, page, calls, setListed };
  }

  it('brings its own slot tab to the front by page identity before the adapter runs', async () => {
    vi.stubEnv('OPENCLI_SITE_SLOTS', 'test-slots:1');
    const { calls } = stubBrowser();

    await executeCommand(pooledCmd('read', async () => { calls.push('adapter'); return []; }), {});

    expect(calls).toEqual(['tabs', 'select:TARGET-1', 'adapter']);
  });

  it.each([
    { label: 'already active', tabs: [{ page: 'TARGET-1', active: true }] },
    { label: 'cold (no tab yet)', tabs: [] },
    { label: 'a window-wide listing', tabs: [{ page: 'MINE', active: false }, { page: 'OTHER', active: true }] },
  ])('does not select when the slot tab is $label', async ({ tabs }) => {
    vi.stubEnv('OPENCLI_SITE_SLOTS', 'test-slots:1');
    const { page, setListed } = stubBrowser();
    setListed(tabs);

    await executeCommand(pooledCmd('read'), {});

    expect(page.selectTab).not.toHaveBeenCalled();
  });

  it('rejects pooled direct-CDP execution before acquiring a daemon slot', async () => {
    vi.stubEnv('OPENCLI_SITE_SLOTS', 'test-slots:1');
    vi.stubEnv('OPENCLI_CDP_ENDPOINT', 'http://127.0.0.1:9222');
    const acquireSpy = vi.spyOn(daemonClient, 'acquireSiteSlot');
    await expect(executeCommand(pooledCmd('read'), {})).rejects.toThrow('requires Browser Bridge');
    expect(acquireSpy).not.toHaveBeenCalled();
  });

  it.each(['test-slots:1000000000', 'test-slots:1:2147483648', 'test-slots:1:0-' + '9'.repeat(400)])('rejects unbounded slot config %s before acquiring', config => {
    vi.stubEnv('OPENCLI_SITE_SLOTS', config);
    return expect(executeCommand(pooledCmd('read'), {})).rejects.toThrow('OPENCLI_SITE_SLOTS');
  });

  it('borrows a slot for a READ run, drives the granted persistent session, and returns the slot', async () => {
    vi.stubEnv('OPENCLI_SITE_SLOTS', 'other:3,test-slots:2:1500-3000');
    const { sessionOpts, acquireSpy, releaseSpy, runCtxSpy } = stubBrowser();

    await executeCommand(pooledCmd('read'), {});

    expect(acquireSpy).toHaveBeenCalledWith(expect.objectContaining({ site: 'test-slots', poolSize: 2, minIntervalMs: 1500, maxIntervalMs: 3000 }));
    expect(sessionOpts[0]).toMatchObject({ session: 'site:test-slots#1', siteSession: 'persistent' });
    const ctx = runCtxSpy.mock.calls[0]?.[0];
    expect(ctx).toMatchObject({ command: 'test-slots/slot-read', access: 'read' });
    expect(releaseSpy).toHaveBeenCalledWith({ runId: ctx!.runId, session: 'site:test-slots#1', surface: 'adapter' });
    expect(runCtxSpy).toHaveBeenLastCalledWith(null);
  });

  it('uses one runId for both the write lease and the slot', async () => {
    vi.stubEnv('OPENCLI_SITE_SLOTS', 'test-slots:1');
    const { runCtxSpy, releaseSpy } = stubBrowser();

    await executeCommand(pooledCmd('write'), {});

    expect(runCtxSpy.mock.calls[0]?.[0]).toMatchObject({ access: 'write' });
    expect(releaseSpy).toHaveBeenCalledTimes(1);
    expect(releaseSpy.mock.calls[0]?.[0].runId).toBe(runCtxSpy.mock.calls[0]?.[0]?.runId);
  });

  it('returns the slot after an ordinary failure but leaves it to the TTL after an unknown outcome', async () => {
    vi.stubEnv('OPENCLI_SITE_SLOTS', 'test-slots:1');
    const { releaseSpy } = stubBrowser();

    await expect(executeCommand(pooledCmd('read', async () => { throw new BrowserCommandError('boom', 'attach_failed'); }), {})).rejects.toThrow('boom');
    expect(releaseSpy).toHaveBeenCalledTimes(1);

    await expect(executeCommand(pooledCmd('read', async () => { throw new BrowserCommandError('unknown', 'command_result_unknown'); }), {})).rejects.toThrow('unknown');
    expect(releaseSpy).toHaveBeenCalledTimes(1);
  });

  it('clears the run context and never opens the browser when no slot is granted', async () => {
    vi.stubEnv('OPENCLI_SITE_SLOTS', 'test-slots:1');
    const { sessionOpts, acquireSpy, releaseSpy, runCtxSpy } = stubBrowser();
    acquireSpy.mockRejectedValue(new BrowserCommandError('No test-slots slot became free within 60s.', 'slot_wait_timeout'));

    await expect(executeCommand(pooledCmd('read'), {})).rejects.toThrow('slot became free');

    expect(sessionOpts).toHaveLength(0);
    expect(releaseSpy).not.toHaveBeenCalled();
    expect(runCtxSpy).toHaveBeenLastCalledWith(null);
  });

  it.each([
    { label: 'unset', env: undefined },
    { label: 'another site only', env: 'other:2' },
    { label: 'a malformed entry for another site', env: 'other:x,test-slots-not:1' },
  ])('leaves the command unpooled when the env is $label', async ({ env }) => {
    if (env !== undefined) vi.stubEnv('OPENCLI_SITE_SLOTS', env);
    else vi.stubEnv('OPENCLI_SITE_SLOTS', '');
    const { sessionOpts, acquireSpy, page } = stubBrowser();

    await executeCommand(pooledCmd('read'), {});

    expect(acquireSpy).not.toHaveBeenCalled();
    expect(page.selectTab).not.toHaveBeenCalled();
    expect(sessionOpts[0]?.siteSession).toBe('ephemeral');
    expect(sessionOpts[0]?.session).toMatch(/^site:test-slots:/);
  });

  it('lets an explicit --site-session ephemeral opt a single invocation out of the pool', async () => {
    vi.stubEnv('OPENCLI_SITE_SLOTS', 'test-slots:1');
    const { sessionOpts, acquireSpy } = stubBrowser();

    await executeCommand(pooledCmd('read'), {}, false, { siteSession: 'ephemeral' });

    expect(acquireSpy).not.toHaveBeenCalled();
    expect(sessionOpts[0]).toMatchObject({ siteSession: 'ephemeral' });
  });

  it('pools even when OPENCLI_SITE_SESSION=ephemeral, since the pool is the more specific opt-in', async () => {
    vi.stubEnv('OPENCLI_SITE_SLOTS', 'test-slots:1');
    vi.stubEnv('OPENCLI_SITE_SESSION', 'ephemeral');
    const { acquireSpy } = stubBrowser();

    await executeCommand(pooledCmd('read'), {});

    expect(acquireSpy).toHaveBeenCalledTimes(1);
  });

  it.each(['test-slots:0', 'test-slots:two', 'test-slots:1:-5', 'test-slots:1:100-x', 'test-slots:', 'test-slots'])
    ('rejects a malformed entry for this site (%s) instead of silently unpooling it', async (env) => {
      vi.stubEnv('OPENCLI_SITE_SLOTS', env);
      const { acquireSpy } = stubBrowser();

      await expect(executeCommand(pooledCmd('read'), {})).rejects.toThrow(ArgumentError);
      expect(acquireSpy).not.toHaveBeenCalled();
    });

  it('still validates OPENCLI_SITE_SESSION for a pooled site', async () => {
    vi.stubEnv('OPENCLI_SITE_SLOTS', 'test-slots:1');
    vi.stubEnv('OPENCLI_SITE_SESSION', 'sometimes');
    stubBrowser();

    await expect(executeCommand(pooledCmd('read'), {})).rejects.toThrow(ArgumentError);
  });

  it('keeps the slot bound through a CLI-layer timeout and returns it when the adapter settles', async () => {
    vi.useFakeTimers();
    vi.stubEnv('OPENCLI_SITE_SLOTS', 'test-slots:1');
    const { releaseSpy, runCtxSpy } = stubBrowser();
    const clearCtxSpy = vi.spyOn(daemonClient, 'clearDaemonRunContext');
    try {
      let finishAdapter!: () => void;
      const adapterGate = new Promise<void>((resolve) => { finishAdapter = resolve; });
      const rejection = expect(executeCommand(pooledCmd('read', async () => { await adapterGate; return []; }), {})).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
      await rejection;

      expect(releaseSpy).not.toHaveBeenCalled();
      expect(runCtxSpy).not.toHaveBeenCalledWith(null);

      finishAdapter();
      await vi.advanceTimersByTimeAsync(0);

      const runId = runCtxSpy.mock.calls[0][0]?.runId;
      expect(clearCtxSpy).toHaveBeenCalledWith(runId);
      expect(releaseSpy).toHaveBeenCalledWith({ runId, session: 'site:test-slots#1', surface: 'adapter' });
    } finally {
      vi.useRealTimers();
      daemonClient.setDaemonRunContext(null);
    }
  });

  it('bounds the queue wait by the user --timeout, else the 60s default', async () => {
    vi.stubEnv('OPENCLI_SITE_SLOTS', 'test-slots:1');
    const { acquireSpy } = stubBrowser();
    const withTimeout = cli({
      site: 'test-slots', name: 'slot-timeout', access: 'read', description: 'test', browser: true, strategy: Strategy.PUBLIC,
      args: [{ name: 'timeout', type: 'int', required: false, default: 300, help: 'Max seconds' }],
      func: async () => [],
    });

    await executeCommand(withTimeout, {});
    await executeCommand(pooledCmd('read'), {});

    expect(acquireSpy.mock.calls[0]?.[0]).toMatchObject({ waitMs: 300_000 });
    expect(acquireSpy.mock.calls[1]?.[0]).toMatchObject({ waitMs: 60_000 });
  });

  it('charges the queue wait against the --timeout budget of the run', async () => {
    vi.stubEnv('OPENCLI_SITE_SLOTS', 'test-slots:1');
    const { acquireSpy } = stubBrowser();
    acquireSpy.mockResolvedValue({ session: 'site:test-slots#0', slot: 0, waitedMs: 100_000 });
    const runWithTimeoutSpy = vi.spyOn(runtime, 'runWithTimeout');
    const withTimeout = cli({
      site: 'test-slots', name: 'slot-budget', access: 'read', description: 'test', browser: true, strategy: Strategy.PUBLIC,
      args: [{ name: 'timeout', type: 'int', required: false, default: 300, help: 'Max seconds' }],
      func: async () => [],
    });

    await executeCommand(withTimeout, {});

    expect(runWithTimeoutSpy.mock.calls[0]?.[1]).toMatchObject({ timeout: 200 + 30 });
  });

  it('treats a single interval value as a fixed spacing', async () => {
    vi.stubEnv('OPENCLI_SITE_SLOTS', ' test-slots:1:2000 ');
    const { acquireSpy } = stubBrowser();

    await executeCommand(pooledCmd('read'), {});

    expect(acquireSpy).toHaveBeenCalledWith(expect.objectContaining({ poolSize: 1, minIntervalMs: 2000, maxIntervalMs: 2000 }));
  });
});
