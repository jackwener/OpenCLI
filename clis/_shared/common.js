/**
 * Shared utilities for CLI adapters.
 */
import { ArgumentError } from '@jackwener/opencli/errors';
/**
 * Clamp a numeric value to [min, max].
 * Matches the signature of lodash.clamp and Rust's clamp.
 */
export function clamp(value, min, max) {
    return Math.max(min, Math.min(value, max));
}
export function clampInt(raw, fallback, min, max) {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return clamp(Math.floor(parsed), min, max);
}
export function normalizeNumericId(value, label, example) {
    const normalized = String(value ?? '').trim();
    if (!/^\d+$/.test(normalized)) {
        throw new ArgumentError(`${label} must be a numeric ID`, `Pass a numeric ${label}, for example: ${example}`);
    }
    return normalized;
}
export function requireNonEmptyQuery(value, label = 'query') {
    const normalized = String(value ?? '').trim();
    if (!normalized) {
        throw new ArgumentError(`${label} cannot be empty`);
    }
    return normalized;
}
