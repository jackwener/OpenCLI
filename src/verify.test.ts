/**
 * Tests for src/verify.ts.
 *
 * Focus: smoke-test directory resolution. `builtinClis` is `<packageRoot>/clis`
 * (see src/main.ts), so the package root — and thus `<packageRoot>/tests/smoke` —
 * must be reached by going a SINGLE level up from `builtinClis`, not two.
 */

import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }));

vi.mock('node:child_process', () => ({ spawn: mockSpawn }));

import { verifyClis } from './verify.js';

/** A fake child process that immediately closes with the given exit code. */
function fakeChild(code: number) {
  const child = new EventEmitter() as EventEmitter & {
    stderr: EventEmitter;
    cwd?: string;
  };
  child.stderr = new EventEmitter();
  queueMicrotask(() => child.emit('close', code));
  return child;
}

describe('verify.ts smoke-test path resolution', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    vi.clearAllMocks();
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('detects tests/smoke under the package root and runs vitest there', async () => {
    // Lay out <tmp>/clis (builtinClis) and <tmp>/tests/smoke so that resolving a
    // single '..' from builtinClis reaches the package root that owns tests/smoke.
    const pkgRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-verify-'));
    tmpDirs.push(pkgRoot);
    const builtinClis = path.join(pkgRoot, 'clis');
    fs.mkdirSync(builtinClis, { recursive: true });
    fs.mkdirSync(path.join(pkgRoot, 'tests', 'smoke'), { recursive: true });

    let spawnCwd: string | undefined;
    mockSpawn.mockImplementation((_cmd: string, _args: string[], opts: { cwd?: string }) => {
      spawnCwd = opts?.cwd;
      return fakeChild(0);
    });

    const report = await verifyClis({ builtinClis, userClis: builtinClis, smoke: true });

    // The smoke dir was found, so vitest was actually spawned at the package root —
    // not short-circuited as the old dead-feature "unavailable" path.
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(spawnCwd).toBe(path.resolve(pkgRoot));
    expect(report.smoke?.executed).toBe(true);
    expect(report.smoke?.ok).toBe(true);
    expect(report.smoke?.summary).not.toContain('unavailable');
  });

  it('reports smoke tests unavailable when no tests/smoke dir exists', async () => {
    const pkgRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-verify-'));
    tmpDirs.push(pkgRoot);
    const builtinClis = path.join(pkgRoot, 'clis');
    fs.mkdirSync(builtinClis, { recursive: true });

    const report = await verifyClis({ builtinClis, userClis: builtinClis, smoke: true });

    expect(mockSpawn).not.toHaveBeenCalled();
    expect(report.smoke?.executed).toBe(false);
    expect(report.smoke?.summary).toContain('unavailable');
  });
});
