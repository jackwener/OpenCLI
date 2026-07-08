import { CommandExecutionError } from '@jackwener/opencli/errors';

export function unwrapEvaluateResult(payload) {
  if (payload && !Array.isArray(payload) && typeof payload === 'object' && 'session' in payload && 'data' in payload) {
    return payload.data;
  }
  return payload;
}

export function requireObjectEvaluateResult(payload, context) {
  const result = unwrapEvaluateResult(payload);
  if (!result || Array.isArray(result) || typeof result !== 'object') {
    throw new CommandExecutionError(`${context}: malformed evaluate payload`);
  }
  return result;
}
