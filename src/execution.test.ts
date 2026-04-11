import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CliCommand } from './registry.js';
import { executeCommand, prepareCommandArgs } from './execution.js';
import { TimeoutError } from './errors.js';
import { cli, Strategy } from './registry.js';
import { withTimeoutMs } from './runtime.js';

const { mockBrowserSession, mockGetBrowserFactory } = vi.hoisted(() => ({
  mockBrowserSession: vi.fn(),
  mockGetBrowserFactory: vi.fn(() => class MockBrowserFactory {}),
}));

vi.mock('./runtime.js', async () => {
  const actual = await vi.importActual<typeof import('./runtime.js')>('./runtime.js');
  return {
    ...actual,
    browserSession: mockBrowserSession,
    getBrowserFactory: mockGetBrowserFactory,
  };
});

vi.mock('./browser/discover.js', () => ({
  checkDaemonStatus: vi.fn().mockResolvedValue({ running: false, extensionConnected: false }),
}));

describe('executeCommand — non-browser timeout', () => {
  const originalDiagnostic = process.env.OPENCLI_DIAGNOSTIC;

  beforeEach(() => {
    mockBrowserSession.mockReset();
    mockGetBrowserFactory.mockClear();
    delete process.env.OPENCLI_DIAGNOSTIC;
  });

  afterEach(() => {
    if (originalDiagnostic === undefined) delete process.env.OPENCLI_DIAGNOSTIC;
    else process.env.OPENCLI_DIAGNOSTIC = originalDiagnostic;
  });

  it('applies timeoutSeconds to non-browser commands', async () => {
    const cmd = cli({
      site: 'test-execution',
      name: 'non-browser-timeout',
      description: 'test non-browser timeout',
      browser: false,
      strategy: Strategy.PUBLIC,
      timeoutSeconds: 0.01,
      func: () => new Promise(() => {}),
    });

    // Sentinel timeout at 200ms — if the inner 10ms timeout fires first,
    // the error will be a TimeoutError with the command label, not 'sentinel'.
    const error = await withTimeoutMs(executeCommand(cmd, {}), 200, 'sentinel timeout')
      .catch((err) => err);

    expect(error).toBeInstanceOf(TimeoutError);
    expect(error).toMatchObject({
      code: 'TIMEOUT',
      message: 'test-execution/non-browser-timeout timed out after 0.01s',
    });
  });

  it('skips timeout when timeoutSeconds is 0', async () => {
    const cmd = cli({
      site: 'test-execution',
      name: 'non-browser-zero-timeout',
      description: 'test zero timeout bypasses wrapping',
      browser: false,
      strategy: Strategy.PUBLIC,
      timeoutSeconds: 0,
      func: () => new Promise(() => {}),
    });

    // With timeout guard skipped, the sentinel fires instead.
    await expect(
      withTimeoutMs(executeCommand(cmd, {}), 50, 'sentinel timeout'),
    ).rejects.toThrow('sentinel timeout');
  });

  it('starts and stops capture in diagnostic mode around browser commands', async () => {
    process.env.OPENCLI_DIAGNOSTIC = '1';

    const startNetworkCapture = vi.fn().mockResolvedValue(undefined);
    const installInterceptor = vi.fn().mockResolvedValue(undefined);
    const stopCapture = vi.fn().mockResolvedValue(undefined);
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const page = {
      goto: vi.fn(),
      startNetworkCapture,
      hasNativeCaptureSupport: vi.fn().mockReturnValue(false),
      installInterceptor,
      stopCapture,
      closeWindow,
    } as any;

    mockBrowserSession.mockImplementationOnce(async (_factory, fn) => fn(page));

    const cmd = cli({
      site: 'test-execution',
      name: 'browser-diagnostic',
      description: 'test browser diagnostic lifecycle',
      browser: true,
      strategy: Strategy.PUBLIC,
      func: async () => ({ ok: true }),
    });

    await executeCommand(cmd, {});

    expect(startNetworkCapture).toHaveBeenCalledTimes(1);
    expect(installInterceptor).toHaveBeenCalledWith('');
    expect(stopCapture).toHaveBeenCalledTimes(1);
    expect(closeWindow).toHaveBeenCalledTimes(1);
    expect(stopCapture.mock.invocationCallOrder[0]).toBeLessThan(closeWindow.mock.invocationCallOrder[0]);
  });

  it('does not retry stopCapture after closeWindow is attempted on the success path', async () => {
    process.env.OPENCLI_DIAGNOSTIC = '1';

    const stopCapture = vi.fn().mockRejectedValue(new Error('cleanup failed'));
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    const page = {
      goto: vi.fn(),
      startNetworkCapture: vi.fn().mockResolvedValue(undefined),
      hasNativeCaptureSupport: vi.fn().mockReturnValue(true),
      stopCapture,
      closeWindow,
    } as any;

    mockBrowserSession.mockImplementationOnce(async (_factory, fn) => fn(page));

    const cmd = cli({
      site: 'test-execution',
      name: 'browser-diagnostic-stop-once',
      description: 'test diagnostic cleanup does not retry after closing window',
      browser: true,
      strategy: Strategy.PUBLIC,
      func: async () => ({ ok: true }),
    });

    await expect(executeCommand(cmd, {})).resolves.toEqual({ ok: true });
    expect(stopCapture).toHaveBeenCalledTimes(1);
    expect(closeWindow).toHaveBeenCalledTimes(1);
  });

  it('does not re-run custom validation when args are already prepared', async () => {
    const validateArgs = vi.fn();
    const cmd: CliCommand = {
      site: 'test-execution',
      name: 'prepared-validation',
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

  it('tolerates diagnostic mode pages that do not implement capture methods', async () => {
    process.env.OPENCLI_DIAGNOSTIC = '1';

    const page = {
      goto: vi.fn(),
      closeWindow: vi.fn().mockResolvedValue(undefined),
    } as any;

    mockBrowserSession.mockImplementationOnce(async (_factory, fn) => fn(page));

    const cmd = cli({
      site: 'test-execution',
      name: 'browser-diagnostic-no-capture',
      description: 'test browser diagnostic compatibility without capture methods',
      browser: true,
      strategy: Strategy.PUBLIC,
      func: async () => ({ ok: true }),
    });

    await expect(executeCommand(cmd, {})).resolves.toEqual({ ok: true });
  });
});
