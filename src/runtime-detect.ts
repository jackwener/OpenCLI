/**
 * Runtime detection — identify whether opencli is running under Node.js or Bun.
 *
 * Bun injects `globalThis.Bun` at startup, making detection trivial.
 * This module centralises the check so other code can adapt behaviour
 * (e.g. logging, diagnostics) without littering runtime sniffing everywhere.
 */

export type Runtime = 'bun' | 'node';

/** Shape of `globalThis` when running under Bun. */
interface BunGlobal {
  Bun?: { version: string };
}

/**
 * Detect the current JavaScript runtime.
 */
export function detectRuntime(): Runtime {
  // Bun always exposes globalThis.Bun (including Bun.version)
  return (globalThis as BunGlobal).Bun !== undefined ? 'bun' : 'node';
}

/**
 * Return a human-readable version string for the current runtime.
 * Examples: "v22.13.0" (Node), "1.1.42" (Bun)
 */
export function getRuntimeVersion(): string {
  const bun = (globalThis as BunGlobal).Bun;
  return bun ? bun.version : process.version;
}

/**
 * Return a combined label like "node v22.13.0" or "bun 1.1.42".
 */
export function getRuntimeLabel(): string {
  return `${detectRuntime()} ${getRuntimeVersion()}`;
}
