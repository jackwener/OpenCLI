import { ArgumentError } from '@jackwener/opencli/errors';
export function normalizeNumericId(value, label, example) {
    const normalized = String(value || '').trim();
    if (!/^\d+$/.test(normalized)) {
        throw new ArgumentError(`${label} must be a numeric ID`, `Pass a numeric ${label}, for example: ${example}`);
    }
    return normalized;
}
