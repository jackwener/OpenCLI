import { execFile, type ChildProcess, type ExecFileOptionsWithStringEncoding } from 'node:child_process';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runEgo } from './ego-transport.js';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

const realExecFile = (await vi.importActual<typeof import('node:child_process')>('node:child_process')).execFile;
const launch = vi.mocked(execFile);
const hostProcess = process;

function useWindows() {
  vi.stubGlobal('process', Object.create(hostProcess, { platform: { value: 'win32' } }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  launch.mockReset();
});

describe('Ego launcher transport', () => {
  it('imports a UTF-8 Windows module, reads its file result with silent stdout, and removes the round files', async () => {
    useWindows();
    const tempParent = await mkdtemp(join(tmpdir(), 'opencli-ego-test-'));
    const temp = join(tempParent, "中文 O'Brien");
    await mkdir(temp);
    for (const key of ['TMPDIR', 'TEMP', 'TMP']) vi.stubEnv(key, temp);
    let scriptPath: string | undefined;
    try {
      launch.mockImplementation((_file, argv, options, callback) => {
        const loader = (argv as string[])[2];
        expect(argv).toEqual(['nodejs', '-e', loader]);
        expect(loader).toMatch(/^[\x20-\x7e]+$/);
        expect(loader).toContain('%27');
        scriptPath = fileURLToPath(loader.split("'")[1]);
        return realExecFile(hostProcess.execPath, ['--input-type=module', '-e', loader],
          options as ExecFileOptionsWithStringEncoding, callback);
      });
      const result = await runEgo('return { query: input };', '袜子测评');
      expect(result).toEqual({ query: '袜子测评' });
      expect(scriptPath).toBeDefined();
      await expect(access(dirname(scriptPath!))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(tempParent, { recursive: true, force: true });
    }
  });

  it('reports a missing Windows result with launcher metadata, without replaying the script', async () => {
    useWindows();
    launch.mockImplementation((_file, _argv, _options, callback) => {
      queueMicrotask(() => callback?.(null, '', 'launcher diagnostic'));
      return { stdin: null } as ChildProcess;
    });

    await expect(runEgo('return 1;', null)).rejects.toMatchObject({
      code: 'BROWSER_CONNECT',
      message: expect.stringContaining('Windows file, exit 0, stdout 0 bytes, stderr 19 bytes'),
    });
    expect(launch).toHaveBeenCalledTimes(1);
  });
});
