import { describe, expect, it, vi } from 'vitest';
import { ExtensionReloadError, readDiskBuildId, reloadExtension } from './extension-reload.js';

const DISK = 'aaaaaaaaaaaaaaaa';
const OLD = 'bbbbbbbbbbbbbbbb';

function clock() {
  let t = 0;
  return {
    now: () => t,
    sleep: vi.fn(async (ms: number) => { t += ms; }),
  };
}

describe('readDiskBuildId', () => {
  it('reads the stamped build id next to the extension bundle', () => {
    const readFile = vi.fn(() => `${DISK}\n`);
    expect(readDiskBuildId('/pkg', readFile)).toBe(DISK);
    expect(readFile).toHaveBeenCalledWith('/pkg/extension/dist/build-id.txt');
  });

  it('returns null for a missing or malformed file', () => {
    expect(readDiskBuildId('/pkg', () => { throw new Error('ENOENT'); })).toBeNull();
    expect(readDiskBuildId('/pkg', () => 'not-a-build-id')).toBeNull();
  });
});

describe('reloadExtension', () => {
  it('does not reload a profile that already runs the on-disk build', async () => {
    const send = vi.fn(async () => ({ buildId: DISK, contextId: 'qa' }));

    const report = await reloadExtension({ send, diskBuildId: DISK, route: { contextId: 'qa' }, ...clock() });

    expect(report).toEqual(expect.objectContaining({ status: 'already_current', profile: 'qa', after: DISK }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('extension-info', { contextId: 'qa' });
  });

  it('reloads, rides out the reconnect, and returns once the new build answers', async () => {
    const answers: Array<() => unknown> = [
      () => ({ buildId: OLD, contextId: 'qa' }),
      () => ({ reloading: true, buildId: OLD, windows: { closed: [], kept: [] } }),
      () => { throw new Error('Browser profile "qa" is not connected.'); },
      () => ({ buildId: OLD, contextId: 'qa' }),
      () => ({ buildId: DISK, contextId: 'qa' }),
    ];
    const send = vi.fn(async (_action: string, _params: Record<string, unknown>) => answers.shift()!());

    const report = await reloadExtension({ send, diskBuildId: DISK, route: { contextId: 'qa' }, force: true, ...clock() });

    expect(report).toEqual({
      status: 'reloaded',
      profile: 'qa',
      before: OLD,
      after: DISK,
      disk: DISK,
      windows: { closed: [], kept: [] },
    });
    expect(send).toHaveBeenNthCalledWith(2, 'reload-extension', { contextId: 'qa', force: true });
    expect(send.mock.calls[2][0]).toBe('extension-info');
  });

  it('passes a busy refusal through without polling', async () => {
    const send = vi.fn(async (action: string) => {
      if (action === 'extension-info') return { buildId: OLD };
      throw new Error('1 opencli command(s) still running in this browser profile');
    });

    await expect(reloadExtension({ send, diskBuildId: DISK, route: {}, ...clock() })).rejects.toThrow('still running');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('names the one manual reload when the extension predates self-reload', async () => {
    const send = vi.fn(async () => { throw new Error('Unknown action: extension-info'); });

    const err = await reloadExtension({ send, diskBuildId: DISK, route: {}, ...clock() }).catch((e) => e);

    expect(err).toBeInstanceOf(ExtensionReloadError);
    expect(err.code).toBe('extension_predates_reload');
    expect(err.hint).toContain('Reload it once by hand');
  });

  it('reads the session error older builds give for the new action as the same case', async () => {
    const send = vi.fn(async () => { throw new Error('Browser session is required.'); });

    const err = await reloadExtension({ send, diskBuildId: DISK, route: {}, ...clock() }).catch((e) => e);

    expect(err.code).toBe('extension_predates_reload');
  });

  it('reports a build that never comes back instead of retrying', async () => {
    const send = vi.fn(async (action: string) => {
      if (action === 'reload-extension') return { reloading: true };
      if (send.mock.calls.length === 1) return { buildId: OLD };
      throw new Error('Browser profile "qa" is not connected.');
    });

    const err = await reloadExtension({ send, diskBuildId: DISK, route: {}, timeoutMs: 5_000, ...clock() }).catch((e) => e);

    expect(err).toBeInstanceOf(ExtensionReloadError);
    expect(err.code).toBe('extension_reload_timeout');
  });

  it('refuses when there is no build on disk to compare against', async () => {
    const send = vi.fn();

    const err = await reloadExtension({ send, diskBuildId: null, route: {}, ...clock() }).catch((e) => e);

    expect(err.code).toBe('extension_build_missing');
    expect(send).not.toHaveBeenCalled();
  });
});
