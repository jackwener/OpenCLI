/**
 * Runtime detection — identify whether opencli is running under Node.js or Bun.
 *
 * Bun injects `globalThis.Bun` at startup, making detection trivial.
 * This module centralises the check so other code can adapt behaviour
 * (e.g. logging, diagnostics) without littering runtime sniffing everywhere.
 */

export type Runtime = 'bun' | 'node';

/**
 * Detect the current JavaScript runtime.
 */
export function detectRuntime(): Runtime {
  // Bun always exposes globalThis.Bun (including Bun.version)
  if (typeof (globalThis as any).Bun !== 'undefined') return 'bun';
  return 'node';
}

/**
 * Return a human-readable version string for the current runtime.
 * Examples: "v22.13.0" (Node), "1.1.42" (Bun)
 */
export function getRuntimeVersion(): string {
  if (detectRuntime() === 'bun') {
    return (globalThis as any).Bun.version as string;
  }
  return process.version; // e.g. "v22.13.0"
}

/**
 * Return a combined label like "node v22.13.0" or "bun 1.1.42".
 */
export function getRuntimeLabel(): string {
  return `${detectRuntime()} ${getRuntimeVersion()}`;
}
