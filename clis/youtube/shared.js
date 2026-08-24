/**
 * Shared helpers for youtube adapters.
 */

/** Unwrap the browser-bridge evaluate envelope ({ session, data }). */
export function unwrapBrowserResult(value) {
    if (value && typeof value === 'object' && 'session' in value && 'data' in value) {
        return value.data;
    }
    return value;
}
