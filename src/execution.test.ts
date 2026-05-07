import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CliCommand } from './registry.js';
import { executeCommand, prepareCommandArgs } from './execution.js';
import { ArgumentError, TimeoutError, toEnvelope } from './errors.js';
import { cli, Strategy } from './registry.js';
import { withTimeoutMs } from './runtime.js';
import * as runtime from './runtime.js';
import * as capRouting from './capabilityRouting.js';

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

  it('reuses a site-scoped browser workspace and keeps the tab lease open', async () => {
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const mockPage = { closeWindow } as any;
    const sessionOpts: Array<{ workspace?: string; idleTimeout?: number }> = [];

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn, opts) => {
      sessionOpts.push(opts ?? {});
      return fn(mockPage);
    });

    const cmd = cli({
      site: 'test-execution',
      name: 'browser-reuse-site', access: 'read',
      description: 'test site-scoped browser reuse',
      browser: true,
      strategy: Strategy.PUBLIC,
      browserSession: { reuse: 'site' },
      func: async () => [{ ok: true }],
    });

    await executeCommand(cmd, {});
    await executeCommand(cmd, {});

    expect(sessionOpts).toHaveLength(2);
    expect(sessionOpts[0]).toMatchObject({ workspace: 'site:test-execution', idleTimeout: 600 });
    expect(sessionOpts[1]).toMatchObject({ workspace: 'site:test-execution', idleTimeout: 600 });
    expect(closeWindow).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('keeps default browser commands on one-shot workspaces', async () => {
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const mockPage = { closeWindow } as any;
    const sessionOpts: Array<{ workspace?: string; idleTimeout?: number }> = [];

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn, opts) => {
      sessionOpts.push(opts ?? {});
      return fn(mockPage);
    });

    const cmd = cli({
      site: 'test-execution',
      name: 'browser-reuse-default', access: 'read',
      description: 'test default one-shot browser workspace',
      browser: true,
      strategy: Strategy.PUBLIC,
      func: async () => [{ ok: true }],
    });

    await executeCommand(cmd, {});
    await executeCommand(cmd, {});

    expect(sessionOpts).toHaveLength(2);
    expect(sessionOpts[0]?.workspace).toMatch(/^site:test-execution:/);
    expect(sessionOpts[1]?.workspace).toMatch(/^site:test-execution:/);
    expect(sessionOpts[0]?.workspace).not.toBe(sessionOpts[1]?.workspace);
    expect(sessionOpts[0]?.idleTimeout).toBeUndefined();
    expect(sessionOpts[1]?.idleTimeout).toBeUndefined();
    expect(closeWindow).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });

  it('lets user --reuse none override adapter reuse metadata', async () => {
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const mockPage = { closeWindow } as any;
    const sessionOpts: Array<{ workspace?: string; idleTimeout?: number }> = [];

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn, opts) => {
      sessionOpts.push(opts ?? {});
      return fn(mockPage);
    });

    const prev = process.env.OPENCLI_BROWSER_REUSE;
    process.env.OPENCLI_BROWSER_REUSE = 'none';
    try {
      const cmd = cli({
        site: 'test-execution',
        name: 'browser-reuse-override-none', access: 'read',
        description: 'test user reuse override',
        browser: true,
        strategy: Strategy.PUBLIC,
        browserSession: { reuse: 'site' },
        func: async () => [{ ok: true }],
      });

      await executeCommand(cmd, {});

      expect(sessionOpts).toHaveLength(1);
      expect(sessionOpts[0]?.workspace).toMatch(/^site:test-execution:/);
      expect(sessionOpts[0]?.idleTimeout).toBeUndefined();
      expect(closeWindow).toHaveBeenCalledTimes(1);
    } finally {
      if (prev === undefined) delete process.env.OPENCLI_BROWSER_REUSE;
      else process.env.OPENCLI_BROWSER_REUSE = prev;
      vi.restoreAllMocks();
    }
  });

  it('skips repeated domain pre-navigation for site-reused browser sessions', async () => {
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
      name: 'browser-reuse-skip-prenav', access: 'read',
      description: 'test reused same-domain tabs do not reset conversation state',
      browser: true,
      strategy: Strategy.COOKIE,
      domain: 'grok.com',
      browserSession: { reuse: 'site' },
      func: async () => [{ ok: true }],
    });

    await executeCommand(cmd, {});

    expect(goto).not.toHaveBeenCalled();
    expect(closeWindow).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('keeps explicit path pre-navigation for site-reused browser sessions', async () => {
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
      name: 'browser-reuse-path-prenav', access: 'read',
      description: 'test explicit path pre-navigation still runs',
      browser: true,
      strategy: Strategy.COOKIE,
      domain: 'example.com',
      navigateBefore: 'https://example.com/dashboard',
      browserSession: { reuse: 'site' },
      func: async () => [{ ok: true }],
    });

    await executeCommand(cmd, {});

    expect(goto).toHaveBeenCalledWith('https://example.com/dashboard');
    expect(closeWindow).not.toHaveBeenCalled();
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

  it('calls closeWindow on browser command failure', async () => {
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
      description: 'test closeWindow on failure',
      browser: true,
      strategy: Strategy.PUBLIC,
      func: async () => { throw new Error('adapter failure'); },
    });

    await expect(executeCommand(cmd, {})).rejects.toThrow('adapter failure');
    expect(closeWindow).toHaveBeenCalledTimes(1);

    vi.restoreAllMocks();
  });

  it('skips closeWindow when OPENCLI_LIVE=1 (success path)', async () => {
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const mockPage = { closeWindow } as any;

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => fn(mockPage));

    const prev = process.env.OPENCLI_LIVE;
    process.env.OPENCLI_LIVE = '1';
    try {
      const cmd = cli({
        site: 'test-execution',
        name: 'browser-live-success', access: 'read',
        description: 'test closeWindow skipped with --live on success',
        browser: true,
        strategy: Strategy.PUBLIC,
        func: async () => [{ ok: true }],
      });

      await executeCommand(cmd, {});
      expect(closeWindow).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.OPENCLI_LIVE;
      else process.env.OPENCLI_LIVE = prev;
      vi.restoreAllMocks();
    }
  });

  it('skips closeWindow when OPENCLI_LIVE=1 (failure path)', async () => {
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const mockPage = { closeWindow } as any;

    vi.spyOn(capRouting, 'shouldUseBrowserSession').mockReturnValue(true);
    vi.spyOn(runtime, 'browserSession').mockImplementation(async (_Factory, fn) => fn(mockPage));

    const prev = process.env.OPENCLI_LIVE;
    process.env.OPENCLI_LIVE = '1';
    try {
      const cmd = cli({
        site: 'test-execution',
        name: 'browser-live-failure', access: 'read',
        description: 'test closeWindow skipped with --live on failure',
        browser: true,
        strategy: Strategy.PUBLIC,
        func: async () => { throw new Error('adapter failure'); },
      });

      await expect(executeCommand(cmd, {})).rejects.toThrow('adapter failure');
      expect(closeWindow).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.OPENCLI_LIVE;
      else process.env.OPENCLI_LIVE = prev;
      vi.restoreAllMocks();
    }
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
