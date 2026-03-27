/**
 * Shared utilities for CLI adapters.
 */

/**
 * Pause for the given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Clamp a numeric value to [min, max] with a fallback default when value is 0/NaN/undefined.
 */
export function clampToRange(value: number, defaultVal: number, min: number, max: number): number {
  return Math.max(min, Math.min(value || defaultVal, max));
}
