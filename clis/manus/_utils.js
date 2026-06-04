// Shared helpers for the Manus (manus.im) web adapter.
//
// Manus is an AI agent platform. Auth uses a `session_id` cookie
// (JWT, ~357 bytes) readable on the manus.im domain. The API uses
// Connect-RPC (POST + JSON + Connect-Protocol-Version: 1).

import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

export const MANUS_DOMAIN = 'manus.im';
export const MANUS_URL = 'https://manus.im/app';
export const API_HOST = 'https://api.manus.im';

export function isManusUrl(value) {
    try {
        const url = new URL(String(value || ''));
        const host = url.hostname.toLowerCase();
        return url.protocol === 'https:' && (host === MANUS_DOMAIN || host === `www.${MANUS_DOMAIN}`);
    } catch {
        return false;
    }
}

/**
 * Validate a `--limit N` argument: must be a positive integer ≤ `max`.
 * Negatives, zero, NaN, Infinity, and non-integers all reject. Manus's
 * Connect-RPC backend enforces these server-side via Buf Validate; failing
 * client-side gives the user a clearer error and skips a wasted round-trip.
 */
export function validatedLimit(raw, fallback, max = 1000) {
    const n = raw == null ? fallback : Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > max) {
        throw new ArgumentError('limit', `must be a positive integer ≤ ${max}`);
    }
    return n;
}

export function unwrapEvaluateResult(payload) {
    if (
        payload
        && typeof payload === 'object'
        && !Array.isArray(payload)
        && Object.prototype.hasOwnProperty.call(payload, 'session')
        && Object.prototype.hasOwnProperty.call(payload, 'data')
    ) {
        return payload.data;
    }
    return payload;
}

function extractErrorMessage(payload) {
    if (!payload || typeof payload !== 'object') return '';
    const candidates = [
        payload.message,
        payload.error,
        payload.errorMessage,
        payload.details,
    ];
    return candidates.find((value) => typeof value === 'string' && value.trim())?.trim() || '';
}

export function requireObject(payload, label) {
    const value = unwrapEvaluateResult(payload);
    if (value?.__authRequired) {
        throw new AuthRequiredError(MANUS_DOMAIN, value.message || 'Authentication required — please sign in to Manus in the browser');
    }
    if (value?.__httpError) {
        const message = extractErrorMessage(value);
        throw new CommandExecutionError(message ? `Manus ${label} failed (HTTP ${value.__httpError}): ${message}` : `Manus ${label} failed (HTTP ${value.__httpError})`);
    }
    if (value?.__error) {
        throw new CommandExecutionError(`Manus ${label} failed: ${value.message || value.__error}`);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new CommandExecutionError(`Manus ${label} returned a malformed API payload`);
    }
    return value;
}

export function requireArray(value, label) {
    if (!Array.isArray(value)) {
        throw new CommandExecutionError(`Manus ${label} returned a malformed API payload`);
    }
    return value;
}

export function requireString(value, label) {
    const text = String(value ?? '').trim();
    if (!text) {
        throw new CommandExecutionError(`Manus ${label} returned a malformed API payload`);
    }
    return text;
}

export async function ensureOnManus(page) {
    const url = unwrapEvaluateResult(await page.evaluate('window.location.href').catch(() => ''));
    if (isManusUrl(url)) return;
    await page.goto(MANUS_URL);
    await page.wait(2);
}

/**
 * IIFE preamble injected into page.evaluate() calls.
 * Provides `callManusAPI(rpcPath, body)` which reads the `session_id`
 * cookie and makes a Connect-RPC POST to api.manus.im.
 */
export const MANUS_API_CALL_JS = `
  const callManusAPI = async (rpcPath, body) => {
    const jwt = document.cookie.split('session_id=')[1]?.split(';')[0];
    if (!jwt) return { __authRequired: true, message: 'session_id cookie missing' };
    const r = await fetch('${API_HOST}/' + rpcPath, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + jwt,
        'Connect-Protocol-Version': '1',
      },
      body: JSON.stringify(body || {}),
    });
    if (!r.ok) {
      const t = await r.text();
      return {
        __httpError: r.status,
        message: t.slice(0, 200),
      };
    }
    try {
      return await r.json();
    } catch (error) {
      return { __error: 'invalid_json', message: error?.message || String(error) };
    }
  };
`;
