import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

export function unwrapEvaluateResult(payload) {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)
        && 'session' in payload && 'data' in payload) {
        return payload.data;
    }
    return payload;
}

export function readRedditListing(result, operation) {
    if (result?.kind === 'auth') {
        throw new AuthRequiredError('reddit.com', result.detail);
    }
    if (result?.kind === 'http') {
        const status = result.status;
        if (typeof status !== 'number') {
            throw new CommandExecutionError(`${operation} HTTP result was missing a numeric status.`);
        }
        if (status === 401 || status === 403) {
            throw new AuthRequiredError('reddit.com', `${operation} returned HTTP ${status}`);
        }
        const hint = status === 429
            ? 'Reddit rate limited this request. Stop retrying and wait for the channel cooldown.'
            : undefined;
        throw new CommandExecutionError(
            `${operation} returned HTTP ${status}.`,
            hint,
        );
    }
    if (result?.kind === 'malformed') {
        throw new CommandExecutionError(`${operation} returned a malformed listing: ${result.detail}`);
    }
    if (result?.kind === 'exception') {
        throw new CommandExecutionError(`${operation} failed: ${result.detail}`);
    }
    if (result?.kind !== 'ok' || !Array.isArray(result.rows)) {
        throw new CommandExecutionError(`Unexpected ${operation} result: ${JSON.stringify(result)}`);
    }
    return result.rows;
}
