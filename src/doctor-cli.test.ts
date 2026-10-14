import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

// `doctor` is mocked at module scope, so these cases live in their own file
// rather than in cli.test.ts, where the mock would apply to every other suite.
const { mockRunBrowserDoctor } = vi.hoisted(() => ({ mockRunBrowserDoctor: vi.fn() }));

vi.mock('./doctor.js', () => ({
  runBrowserDoctor: mockRunBrowserDoctor,
  renderBrowserDoctorReport: () => 'doctor text report',
}));

import { createProgram } from './cli.js';

const healthy = { ok: true, daemonRunning: true, extensionConnected: true, issues: [] };
const unhealthy = {
  ok: false,
  daemonRunning: false,
  extensionConnected: false,
  issues: ['Daemon is not running.'],
};

describe('doctor --strict / -f', () => {
  let stdout: string[];
  let logSpy: MockInstance;
  let writeSpy: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = 0;
    stdout = [];
    logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      stdout.push(args.join(' '));
    });
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdout.push(String(chunk));
      return true;
    });
  });

  async function runDoctor(argv: string[]): Promise<{ exitCode: number; out: string }> {
    const program = createProgram('', '');
    await program.parseAsync(['node', 'opencli', 'doctor', ...argv]);
    // process.exitCode is `number | string | undefined` in Node's types.
    const exitCode = Number(process.exitCode ?? 0);
    logSpy.mockRestore();
    writeSpy.mockRestore();
    return { exitCode, out: stdout.join('\n') };
  }

  it('exits non-zero with --strict when the bridge is unhealthy', async () => {
    mockRunBrowserDoctor.mockResolvedValue(unhealthy);

    const { exitCode } = await runDoctor(['--strict']);

    expect(exitCode).toBe(1);
  });

  // Default behavior must stay exit 0 even when unhealthy: scripts and
  // interactive users running under `set -e` predate --strict.
  it('exits zero without --strict even when the bridge is unhealthy', async () => {
    mockRunBrowserDoctor.mockResolvedValue(unhealthy);

    const { exitCode } = await runDoctor([]);

    expect(exitCode).toBe(0);
  });

  it('exits zero with --strict when the bridge is healthy', async () => {
    mockRunBrowserDoctor.mockResolvedValue(healthy);

    const { exitCode } = await runDoctor(['--strict']);

    expect(exitCode).toBe(0);
  });

  it('renders the text report by default', async () => {
    mockRunBrowserDoctor.mockResolvedValue(healthy);

    const { out } = await runDoctor([]);

    expect(out).toContain('doctor text report');
  });

  it('emits the report as JSON with -f json', async () => {
    mockRunBrowserDoctor.mockResolvedValue(unhealthy);

    const { out } = await runDoctor(['-f', 'json']);

    expect(out).not.toContain('doctor text report');
    expect(JSON.parse(out)).toMatchObject({ ok: false, issues: ['Daemon is not running.'] });
  });

  it('combines -f json with a non-zero --strict exit', async () => {
    mockRunBrowserDoctor.mockResolvedValue(unhealthy);

    const { exitCode, out } = await runDoctor(['--strict', '-f', 'json']);

    expect(exitCode).toBe(1);
    expect(JSON.parse(out).ok).toBe(false);
  });
});
