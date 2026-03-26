/**
 * Shared helpers for E2E tests.
 * Runs the built opencli binary as a subprocess.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const MAIN = path.join(ROOT, 'dist', 'main.js');

export interface CliResult {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Run `opencli` as a child process with the given arguments.
 * Without PLAYWRIGHT_MCP_EXTENSION_TOKEN, opencli auto-launches its own browser.
 */
export async function runCli(
  args: string[],
  opts: { timeout?: number; env?: Record<string, string> } = {},
): Promise<CliResult> {
  const timeout = opts.timeout ?? 30_000;
  try {
    const runtime = process.env.OPENCLI_TEST_RUNTIME || 'node';
    const { stdout, stderr } = await exec(runtime, [MAIN, ...args], {
      cwd: ROOT,
      timeout,
      env: {
        ...process.env,
        // Prevent chalk colors from polluting test assertions
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        ...opts.env,
      },
    });
    return { stdout, stderr, code: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
      code: err.code ?? 1,
    };
  }
}

/**
 * Parse JSON output from a CLI command.
 * Throws a descriptive error if parsing fails.
 */
export function parseJsonOutput(stdout: string): any {
  try {
    return JSON.parse(stdout.trim());
  } catch {
    throw new Error(`Failed to parse CLI JSON output:\n${stdout.slice(0, 500)}`);
  }
}
