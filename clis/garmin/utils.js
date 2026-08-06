// Helpers for the Garmin Connect adapter.
//
// Garmin's modern web app talks to same-origin JSON services under `/gc-api/...`.
// Those endpoints authenticate off the logged-in session cookie plus two request
// headers: `connect-csrf-token` (published in a <meta> tag on every Connect page)
// and `NK: NT`. garminApi() reproduces exactly that from inside the bound tab.
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

export const GC = 'https://connect.garmin.com';

// Navigate the bound tab onto Connect (where the CSRF <meta> + session cookie live)
// if it isn't already there.
export async function ensureGarmin(page) {
    const url = await page.evaluate('() => location.href');
    if (!/connect\.garmin\.com/.test(url || '')) {
        await page.goto('https://connect.garmin.com/modern/home');
        await page.wait(2);
    }
}

// Call a /gc-api JSON endpoint through the logged-in browser context.
// opts: { method = 'GET', form } where `form` is an object serialised as
// application/x-www-form-urlencoded (Garmin's services expect form bodies, not JSON).
export async function garminApi(page, path, opts = {}) {
    const method = opts.method || 'GET';
    const formBody = opts.form
        ? Object.keys(opts.form).map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(opts.form[k])}`).join('&')
        : null;
    const res = await page.evaluate(`(async () => {
    const csrf = document.querySelector('meta[name*="csrf" i]')?.getAttribute('content') || '';
    if (!csrf) return { noCsrf: true };
    try {
      const headers = { 'connect-csrf-token': csrf, 'NK': 'NT' };
      const init = { method: ${JSON.stringify(method)}, credentials: 'include', headers };
      ${formBody != null ? `headers['Content-Type'] = 'application/x-www-form-urlencoded'; init.body = ${JSON.stringify(formBody)};` : ''}
      const r = await fetch(${JSON.stringify(path)}, init);
      const text = await r.text();
      let data = null; try { data = JSON.parse(text); } catch (e) {}
      return { status: r.status, data, raw: data == null ? text.slice(0, 200) : null };
    } catch (e) { return { fetchError: String(e).slice(0, 160) }; }
  })()`);
    if (!res || res.noCsrf)
        throw new AuthRequiredError('connect.garmin.com', 'Not logged into Garmin Connect (no CSRF token). Sign in via the bound Chrome tab, then retry.');
    if (res.fetchError)
        throw new CommandExecutionError(`Garmin request failed: ${res.fetchError}`);
    if (res.status === 401 || res.status === 403)
        throw new AuthRequiredError('connect.garmin.com', 'Garmin session expired or unauthorized. Sign in via the bound Chrome tab, then retry.');
    if (res.status >= 400)
        throw new CommandExecutionError(`Garmin API ${res.status}${res.raw ? `: ${res.raw}` : ''}`);
    // 204 / empty success bodies return null data — surface a small ok marker.
    return res.data == null ? { ok: true, status: res.status } : res.data;
}

// Write commands have real social side effects, so they refuse to run without --execute.
export function requireExecute(kwargs, action) {
    if (!kwargs || kwargs.execute !== true)
        throw new ArgumentError(`Refusing to ${action} without --execute. Re-run with --execute to actually perform this.`);
}

// Accept a bare displayName GUID, an /app/profile/<guid> path, or a full profile URL.
export function normalizeDisplayName(input) {
    if (input == null)
        return '';
    const fromPath = String(input).match(/\/profile\/([0-9a-fA-F-]{36})/);
    if (fromPath)
        return fromPath[1];
    const guid = String(input).match(/[0-9a-fA-F-]{36}/);
    return guid ? guid[0] : String(input).trim();
}

// Fetch the social profile once; many endpoints key off displayName / profileId.
export async function getProfile(page) {
    const sp = await garminApi(page, '/gc-api/userprofile-service/socialProfile');
    if (!sp || !sp.displayName)
        throw new AuthRequiredError('connect.garmin.com', 'Could not read Garmin profile. Sign in via the bound Chrome tab, then retry.');
    return sp;
}

// ── pure formatters (unit-tested) ───────────────────────────────────────
export function metersToKm(m, digits = 2) {
    if (m == null || Number.isNaN(Number(m)))
        return '';
    return (Number(m) / 1000).toFixed(digits);
}

export function secondsToHms(s) {
    if (s == null || Number.isNaN(Number(s)))
        return '';
    const total = Math.round(Number(s));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const sec = total % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(sec).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

// Validate a YYYY-MM-DD date, or fall back to today (local).
export function isoDate(input) {
    if (input && /^\d{4}-\d{2}-\d{2}$/.test(String(input)))
        return String(input);
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
}

// Accept a bare id, an /activity/<id> path, or a full activity URL.
export function normalizeActivityId(input) {
    if (input == null)
        return '';
    const fromPath = String(input).match(/\/activity\/(\d+)/);
    if (fromPath)
        return fromPath[1];
    const digits = String(input).match(/(\d+)/);
    return digits ? digits[1] : '';
}
