// Shared helpers for the Manus (manus.im) web adapter.
//
// Manus is an AI agent platform. Auth uses a `session_id` cookie
// (JWT, ~357 bytes) readable on the manus.im domain. The API uses
// Connect-RPC (POST + JSON + Connect-Protocol-Version: 1).

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

export async function ensureOnManus(page) {
    const url = await page.evaluate('window.location.href').catch(() => '');
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
    if (!jwt) throw new Error('Not signed in to manus.im — session_id cookie missing');
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
      throw new Error('Manus API ' + r.status + ': ' + t.slice(0, 200));
    }
    return r.json();
  };
`;