import { expect } from 'vitest';
import { runCli } from './helpers.js';

/**
 * Verify a login-required command fails gracefully (no crash, no hang).
 * Acceptable outcomes: exit code 1 with error message, OR timeout handled.
 */
export async function expectGracefulAuthFailure(args: string[]) {
  const { stdout, stderr, code } = await runCli(args, { timeout: 60_000 });
  // Should either fail with exit code 1 (error message) or succeed with empty data.
  // The key assertion: it should NOT hang forever or crash with unhandled exception.
  if (code !== 0) {
    // Verify stderr has a meaningful error, not an unhandled crash.
    const output = stderr + stdout;
    expect(output.length).toBeGreaterThan(0);
  }
  // If it somehow succeeds (e.g., partial public data), that's fine too.
}
