/**
 * Runtime detection — identify whether opencli is running under Node.js or Bun.
 *
 * Bun injects `globalThis.Bun` at startup, making detection trivial.
 * This module centralises the check so other code can adapt behaviour
 * (e.g. logging, diagnostics) without littering runtime sniffing everywhere.
 */

export type Runtime = 'bun' | 'node';
export const MIN_SUPPORTED_NODE_MAJOR = 20;

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

/**
 * Parse a Node.js version string like "v22.13.0" and return its major version.
 * Returns null for non-Node or malformed inputs.
 */
export function parseNodeMajor(version: string): number | null {
  const match = /^v?(\d+)\./.exec(String(version).trim());
  if (!match) return null;
  const major = Number(match[1]);
  return Number.isInteger(major) ? major : null;
}

/**
 * Whether the given Node.js version satisfies the current minimum support policy.
 */
export function isSupportedNodeVersion(version: string = process.version): boolean {
  const major = parseNodeMajor(version);
  return major !== null && major >= MIN_SUPPORTED_NODE_MAJOR;
}
