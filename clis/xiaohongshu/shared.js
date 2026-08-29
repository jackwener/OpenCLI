/**
 * Unwrap a Browser Bridge `{ session, data }` envelope while preserving raw
 * payload identity. Named array properties do not survive Bridge/CDP JSON.
 */
export function unwrapEvaluateResult(payload) {
    if (payload && !Array.isArray(payload) && typeof payload === 'object' && 'session' in payload && 'data' in payload) {
        return payload.data;
    }
    return payload;
}
