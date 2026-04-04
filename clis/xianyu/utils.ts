import { ArgumentError } from '../../errors.js';

export function normalizeNumericId(value: unknown, label: string, example: string): string {
  const normalized = String(value || '').trim();
  if (!/^\d+$/.test(normalized)) {
    throw new ArgumentError(`${label} must be a numeric ID`, `Pass a numeric ${label}, for example: ${example}`);
  }
  return normalized;
}
