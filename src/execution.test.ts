import { describe, expect, it, vi } from 'vitest';
import type { CliCommand } from './registry.js';
import { executeCommand, prepareCommandArgs } from './execution.js';
import { TimeoutError } from './errors.js';
import { cli, Strategy } from './registry.js';
import { withTimeoutMs } from './runtime.js';
import * as runtime from './runtime.js';
import * as capRouting from './capabilityRouting.js';

describe('executeCommand — non-browser timeout', () => {
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
      name: 'browser-close-on-error',
      description: 'test closeWindow on failure',
      browser: true,
      strategy: Strategy.PUBLIC,
      func: async () => { throw new Error('adapter failure'); },
    });

    await expect(executeCommand(cmd, {})).rejects.toThrow('adapter failure');
    expect(closeWindow).toHaveBeenCalledTimes(1);

    vi.restoreAllMocks();
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
});
