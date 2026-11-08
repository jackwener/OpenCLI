// Instagram profile reads through the web client's own query.
//
// Instagram retired the REST reads `instagram profile` used for web sessions:
// /api/v1/users/web_profile_info/, /api/v1/feed/user/<name>/username/ and
// /api/v1/feed/user/<id>/ answer 404 with the app shell, and
// /api/v1/users/<id>/info/ answers 429 (#2456, #2553). The web client loads a
// profile with the Relay query PolarisProfilePageContentQuery.
//
// Its persisted doc_id rotates, so it is not replayed. Instead, in a fresh
// document, a read-only observer is installed on XHR/fetch, the client is routed
// to the profile through the history API (so the observer survives), and the
// response Instagram's own client requested is read. Nothing is sent that the
// client would not send when the profile is opened.
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError, TimeoutError } from '@jackwener/opencli/errors';
import { gotoInstagramHome } from './navigation.js';

export const INSTAGRAM_PROFILE_QUERY = 'PolarisProfilePageContentQuery';
const USERNAME_RE = /^[A-Za-z0-9._]{1,30}$/;

/**
 * Runs in the page (embedded with `.toString()`; must stay self-contained).
 * Resolves to `{ kind: 'ok', user }` or a failure kind and never throws.
 */
export async function captureInstagramProfileInPage(username, timeoutMs) {
    const responses = [];
    const nameOf = (body) => {
        try {
            if (typeof body === 'string') return new URLSearchParams(body).get('fb_api_req_friendly_name');
            if (body && typeof body.get === 'function') return body.get('fb_api_req_friendly_name');
        } catch { /* not a form body */ }
        return null;
    };
    const keep = (name, text) => { if (name === 'PolarisProfilePageContentQuery') responses.push(text); };
    const proto = XMLHttpRequest.prototype;
    const originalOpen = proto.open;
    const originalSend = proto.send;
    const originalFetch = window.fetch;
    proto.open = function (method, url) { this.__opencliUrl = String(url); return originalOpen.apply(this, arguments); };
    proto.send = function (body) {
        const name = /graphql/.test(this.__opencliUrl || '') ? nameOf(body) : null;
        if (name) this.addEventListener('load', () => keep(name, String(this.responseText || '')));
        return originalSend.apply(this, arguments);
    };
    window.fetch = async function (input, init) {
        const response = await originalFetch.apply(this, arguments);
        const name = nameOf(init && init.body);
        if (name) response.clone().text().then((text) => keep(name, text), () => {});
        return response;
    };
    const parse = (text) => {
        for (const chunk of [text, String(text).split('\n')[0]]) {
            try { return JSON.parse(String(chunk).replace(/^for \(;;\);/, '')); } catch { /* try the next form */ }
        }
        return null;
    };
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    let error = '';
    try {
        if (!/(?:^|;\s*)ds_user_id=/.test(document.cookie)) return { kind: 'auth' };
        history.pushState({}, '', '/' + encodeURIComponent(username) + '/');
        window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            await sleep(250);
            while (responses.length) {
                const json = parse(responses.shift());
                if (!json || typeof json !== 'object') { error = error || 'response was not JSON'; continue; }
                if (Array.isArray(json.errors) && json.errors.length) {
                    error = error || String(json.errors[0].message || json.errors[0].summary || 'GraphQL error');
                }
                const data = json.data && typeof json.data === 'object' ? json.data : null;
                if (!data || !('user' in data)) continue;
                if (!data.user) return { kind: 'not-found' };
                if (String(data.user.username || '').toLowerCase() !== username.toLowerCase()) {
                    return { kind: 'mismatch', got: String(data.user.username || '') };
                }
                return { kind: 'ok', user: data.user };
            }
            if (/sorry, this page isn.t available/i.test((document.body && (document.body.innerText || document.body.textContent)) || '')) return { kind: 'not-found' };
        }
        return { kind: 'timeout', error };
    } catch (caught) {
        return { kind: 'exception', detail: String((caught && caught.message) || caught) };
    } finally {
        proto.open = originalOpen;
        proto.send = originalSend;
        window.fetch = originalFetch;
    }
}

function unwrapEvaluateResult(result) {
    return result && typeof result === 'object' && !Array.isArray(result) && 'data' in result && 'session' in result
        ? result.data
        : result;
}

export function normalizeInstagramUsername(value) {
    const username = String(value ?? '').trim().replace(/^@/, '');
    if (!USERNAME_RE.test(username)) throw new ArgumentError(`Invalid Instagram username: ${value}`);
    return username;
}

/** Read one profile's user object through the web client. */
export async function readInstagramProfileUser(page, rawUsername, { timeoutMs = 25000 } = {}) {
    const username = normalizeInstagramUsername(rawUsername);
    await gotoInstagramHome(page, true);
    const script = `(${captureInstagramProfileInPage.toString()})(${JSON.stringify(username)}, ${Number(timeoutMs)})`;
    let result;
    // Instagram answers an unknown username with a full document load, which
    // destroys the evaluation context. Read once more in the new document, where
    // the "page isn't available" screen is detected; never more than once.
    for (let attempt = 0; attempt < 2 && !result; attempt++) {
        try {
            result = unwrapEvaluateResult(await page.evaluate(script));
        } catch {
            if (attempt === 1) throw new CommandExecutionError('Instagram page request failed (network or browser context)', 'Check the Instagram page and retry after any temporary restriction clears.');
        }
    }
    switch (result?.kind) {
        case 'ok':
            return result.user;
        case 'auth':
            throw new AuthRequiredError('www.instagram.com', 'Not logged in to Instagram (no ds_user_id cookie in this browser session)');
        case 'not-found':
            throw new EmptyResultError(`instagram profile ${username}`, `Instagram has no account named ${username}, or it is not visible to this session.`);
        case 'mismatch':
            throw new CommandExecutionError(`Instagram loaded @${result.got} instead of @${username}.`);
        case 'timeout':
            throw new TimeoutError(
                `Instagram ${INSTAGRAM_PROFILE_QUERY} for @${username}`,
                Math.round(timeoutMs / 1000),
                result.error
                    ? `Instagram reported: ${result.error}. Wait before retrying; no automatic retry was attempted.`
                    : 'Instagram may be rate limiting this session. Wait before retrying; no automatic retry was attempted.',
            );
        case 'exception':
            throw new CommandExecutionError(`Instagram profile read failed: ${result.detail}`);
        default:
            throw new CommandExecutionError('Instagram returned an invalid profile read result');
    }
}

function profilePicUrl(user) {
    const candidates = [user.profile_pic_url_hd, user.hd_profile_pic_url_info?.url, user.profile_pic_url];
    return candidates.find((value) => typeof value === 'string' && value.startsWith('https://')) || '';
}

export function mapInstagramProfileRow(user) {
    if (!user || typeof user !== 'object' || typeof user.username !== 'string' || !user.username.trim()) {
        throw new CommandExecutionError('Instagram profile returned a malformed user payload');
    }
    return {
        username: user.username,
        name: typeof user.full_name === 'string' ? user.full_name : '',
        followers: user.follower_count ?? 0,
        following: user.following_count ?? 0,
        posts: user.media_count ?? 0,
        verified: user.is_verified ? 'Yes' : 'No',
        bio: (typeof user.biography === 'string' ? user.biography : '').replace(/\n/g, ' ').substring(0, 120),
        // Signed CDN URL: expires after a while, so download it rather than hotlink it.
        avatar_url: profilePicUrl(user),
    };
}
