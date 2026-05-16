/**
 * Shared Weibo utilities — uid extraction.
 */
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
/**
 * `page.evaluate` may return either the raw IIFE value or a
 * `{ session, data }` envelope depending on the browser-bridge version.
 * Adapter code that inspected the payload directly (e.g. `Array.isArray`,
 * truthiness checks on uid strings) silently received the envelope wrapper
 * instead of the inner value. This helper normalizes both shapes so callers
 * can keep their existing checks unchanged.
 */
export function unwrapEvaluateResult(payload) {
    if (payload && !Array.isArray(payload) && typeof payload === 'object' && 'session' in payload && 'data' in payload) {
        return payload.data;
    }
    return payload;
}
export function requireArrayEvaluateResult(payload, label) {
    if (!Array.isArray(payload)) {
        if (payload && typeof payload === 'object' && 'error' in payload) {
            throw new CommandExecutionError(`${label}: ${String(payload.error)}`);
        }
        throw new CommandExecutionError(`${label} returned malformed extraction payload`);
    }
    return payload;
}
export function requireObjectEvaluateResult(payload, label) {
    if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
        throw new CommandExecutionError(`${label} returned malformed extraction payload`);
    }
    return payload;
}
/** Get the currently logged-in user's uid from Vue store or config API. */
export async function getSelfUid(page) {
    const uid = unwrapEvaluateResult(await page.evaluate(`
    (() => {
      const app = document.querySelector('#app')?.__vue_app__;
      const store = app?.config?.globalProperties?.$store;
      const uid = store?.state?.config?.config?.uid;
      if (uid) return String(uid);
      return null;
    })()
  `));
    if (uid)
        return uid;
    // Fallback: config API
    const config = unwrapEvaluateResult(await page.evaluate(`
    (async () => {
      const resp = await fetch('/ajax/config/get_config', {credentials: 'include'});
      if (!resp.ok) return null;
      const data = await resp.json();
      return data.ok && data.data?.uid ? String(data.data.uid) : null;
    })()
  `));
    if (config)
        return config;
    throw new AuthRequiredError('weibo.com');
}
