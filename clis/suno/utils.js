/**
 * Suno web (suno.com) browser automation helpers — rewritten for the
 * /api/generate/v2-web/ schema introduced 2026-05.
 *
 * Auth model: Bearer JWT from Clerk (`window.Clerk.session.getToken()`).
 *
 * The studio backend lives on `studio-api-prod.suno.com`; the page itself is
 * on `suno.com`. The browser's normal cross-origin cookie-bearing fetch
 * succeeds from a real Chrome tab, but the OpenCLI bridge's evaluate
 * context isolates third-party cookies — `credentials: 'include'` drops the
 * Clerk session cookie. Sending the JWT explicitly as `Authorization: Bearer`
 * bypasses the isolation and matches the auth path the studio API expects.
 *
 * Required custom headers (in addition to Bearer):
 *   - browser-token: {"token":"<base64 of {timestamp: ms}>"} (anti-replay)
 *   - device-id: <uuid> (persistent per browser, found in `suno_device_id` cookie)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError, TimeoutError } from '@jackwener/opencli/errors';

export const SUNO_DOMAIN = 'suno.com';
export const SUNO_URL = 'https://suno.com';
export const STUDIO_API = 'https://studio-api-prod.suno.com';
export const SUNO_CDN = 'https://cdn1.suno.ai';

// As of 2026-05, the UI exposes V5.5 (chirp-fenix) and V4.5+ (chirp-bluejay).
// Older versions are still routable via the API and remain valid `mv` values.
export const SUNO_MODELS = ['chirp-fenix', 'chirp-bluejay', 'chirp-v4', 'chirp-v3-5'];
export const DEFAULT_SUNO_MODEL = 'chirp-fenix';

export const SUPPORTED_FORMATS = ['mp3', 'm4a', 'wav', 'video', 'cover', 'metadata'];
export const DEFAULT_FORMATS = ['mp3', 'metadata'];

export function parseFormats(value) {
    if (value === undefined || value === null || value === '') return DEFAULT_FORMATS.slice();
    const raw = Array.isArray(value) ? value.join(',') : String(value);
    const parts = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (!parts.length) return DEFAULT_FORMATS.slice();
    const unknown = parts.filter(p => !SUPPORTED_FORMATS.includes(p));
    if (unknown.length) {
        throw new ArgumentError(
            `Unsupported --formats value(s): ${unknown.join(', ')}`,
            `Supported: ${SUPPORTED_FORMATS.join(', ')}. (stems require multi-step extraction and are not yet wired.)`,
        );
    }
    return Array.from(new Set(parts));
}

export function resolveSunoOutputDir(value) {
    const raw = String(value || '').trim();
    if (!raw) return path.join(process.env.HOME || '~', 'Music', 'suno');
    if (raw === '~') return process.env.HOME || '~';
    if (raw.startsWith('~/')) return path.join(process.env.HOME || '~', raw.slice(2));
    return path.resolve(raw);
}

export function sanitizeTitleForFilename(title, fallback = 'untitled') {
    const cleaned = String(title || fallback)
        .replace(/[\\/:*?"<>|\x00-\x1f]+/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60);
    return cleaned || fallback;
}

export function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

export function normalizeBooleanFlag(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (value === null || value === undefined || value === '') return fallback;
    const s = String(value).trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'yes' || s === 'on';
}

export function unwrapEvaluateResult(value) {
    if (value && typeof value === 'object' && 'session' in value && 'data' in value) {
        return value.data;
    }
    return value;
}

export function requirePositiveInt(value, label) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) {
        throw new ArgumentError(`${label} must be a positive integer`);
    }
    return n;
}

export function requireNonNegativeInt(value, label) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) {
        throw new ArgumentError(`${label} must be a non-negative integer`);
    }
    return n;
}

export function clampSlider(value, label, def) {
    if (value === undefined || value === null || value === '') return def;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
        throw new ArgumentError(`${label} must be a number between 0 and 1`);
    }
    return n;
}

// ─────────────────────────────────────────────────────────────────────────────
// In-page helper snippets. Each is inlined into a page.evaluate() call so
// the browser-token is generated fresh per request and the Clerk token is
// pulled live (avoiding 60s TTL expiry on long polls).
// ─────────────────────────────────────────────────────────────────────────────

const BROWSER_TOKEN_JS = `JSON.stringify({ token: btoa(JSON.stringify({ timestamp: Date.now() })) })`;
const CLERK_TOKEN_JS = `await window.Clerk.session.getToken()`;

/**
 * Build the standard header set used by every studio-api-prod.suno.com call.
 *
 * deviceId is read once per command and embedded literally; browser-token
 * and Authorization are computed inline (timestamp/JWT refresh per call).
 */
function sunoHeadersJs(deviceId, extra = {}) {
    const extraEntries = Object.entries(extra).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ');
    return `{
        'Authorization': 'Bearer ' + ${CLERK_TOKEN_JS},
        'browser-token': ${BROWSER_TOKEN_JS},
        'device-id': ${JSON.stringify(deviceId)},
        ${extraEntries}${extraEntries ? ',' : ''}
    }`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Session bootstrap.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse studio-api-prod billing/info. Inlined into the page IIFE via
 * toString() so the same parser runs in Node tests and the browser.
 */
export function parseSunoBillingInfo(data) {
    const packCredits = (data?.credit_packs || []).reduce((s, p) => s + (p?.amount ?? p?.credits ?? 0), 0);
    const monthlyRemaining = Math.max(0, (data?.monthly_limit ?? 0) - (data?.monthly_usage ?? 0));
    const totalCreditsAvailable = typeof data?.total_credits_left === 'number'
        ? data.total_credits_left
        : (data?.credits ?? 0) + packCredits + monthlyRemaining;
    const plans = Array.isArray(data?.plans) ? data.plans : [];
    const subscriptionKey = typeof data?.subscription_type === 'string' && data.subscription_type
        ? data.subscription_type
        : null;
    const currentPlan = subscriptionKey
        ? plans.find((p) => p?.plan_key === subscriptionKey)
        : plans.find((p) => p?.plan_key === 'free');
    return {
        planId: currentPlan?.id || data?.plan?.id || null,
        planKey: currentPlan?.plan_key || data?.plan?.plan_key || (subscriptionKey ?? 'free'),
        totalCreditsAvailable,
        breakdown: {
            pack: data?.credits ?? 0,
            purchasedPacks: packCredits,
            monthlyRemaining,
            monthlyLimit: data?.monthly_limit ?? 0,
            monthlyUsed: data?.monthly_usage ?? 0,
        },
    };
}

export async function ensureSunoSession(page) {
    await page.goto(`${SUNO_URL}/me`, { settleMs: 2000 });
    // OneTrust consent banner can block the page; dismiss it if present.
    await page.evaluate(`(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => /^reject all$|^accept all$|^confirm/i.test((b.innerText || '').trim()));
        if (btn) btn.click();
    })()`);

    // Wait briefly for Clerk to mount before any API call.
    for (let i = 0; i < 20; i += 1) {
        const ready = unwrapEvaluateResult(await page.evaluate(`!!(window.Clerk && window.Clerk.session)`));
        if (ready) break;
        await page.wait(0.5);
    }

    const deviceId = await getSunoDeviceId(page);
    const result = unwrapEvaluateResult(await page.evaluate(`(async () => {
        try {
            if (!window.Clerk?.session) return { ok: false, auth: true, error: 'Clerk session unavailable' };
            const res = await fetch('${STUDIO_API}/api/billing/info/', { headers: ${sunoHeadersJs(deviceId)} });
            if (!res.ok) return { ok: false, status: res.status, body: (await res.text()).slice(0, 300) };
            let data = null;
            try {
                data = await res.json();
            } catch (e) {
                return { ok: false, error: 'Malformed billing/info JSON: ' + String(e).slice(0, 200) };
            }
            const parse = ${parseSunoBillingInfo.toString()};
            return { ok: true, ...parse(data) };
        } catch (e) {
            return { ok: false, error: String(e).slice(0, 200) };
        }
    })()`));

    if (!result || !result.ok) {
        const detail = result?.status || result?.error || 'unknown';
        if (result?.auth || result?.status === 401 || result?.status === 403) {
            throw new AuthRequiredError(SUNO_DOMAIN, `Suno session check failed (${detail}). Open https://suno.com in Chrome and sign in, then retry.`);
        }
        throw new CommandExecutionError(`Suno session check failed (${detail}).`);
    }
    return { ...result, deviceId };
}

/**
 * Verify the captcha pre-flight. If `required:true`, the simple flow won't
 * work without solving a CAPTCHA (out of scope for the headless adapter).
 */
export async function checkSunoCaptcha(page, deviceId) {
    const result = unwrapEvaluateResult(await page.evaluate(`(async () => {
        const res = await fetch('${STUDIO_API}/api/c/check', {
            method: 'POST',
            headers: ${sunoHeadersJs(deviceId, { 'Content-Type': 'application/json' })},
            body: JSON.stringify({ ctype: 'generation' }),
        });
        if (!res.ok) return { ok: false, status: res.status };
        return { ok: true, ...(await res.json()) };
    })()`));
    return result; // { ok, required, captcha_version }
}

// ─────────────────────────────────────────────────────────────────────────────
// device-id discovery. Suno frontend writes `suno_device_id` as a cookie on
// first load; we re-use it so every command shares the same identity.
// ─────────────────────────────────────────────────────────────────────────────

export async function getSunoDeviceId(page) {
    const id = unwrapEvaluateResult(await page.evaluate(`(() => {
        try {
            const fromCookie = document.cookie.split(';').map(s => s.trim()).find(s => s.startsWith('suno_device_id='));
            if (fromCookie) return decodeURIComponent(fromCookie.split('=')[1]);
            for (const key of ['device_id', 'deviceId', 'suno_device_id']) {
                const v = localStorage.getItem(key);
                if (v) return v.replace(/^"|"$/g, '');
            }
        } catch {}
        return null;
    })()`));
    if (id && typeof id === 'string') return id;
    return unwrapEvaluateResult(await page.evaluate(`crypto.randomUUID()`));
}

// ─────────────────────────────────────────────────────────────────────────────
// Generate (Custom or Simple mode).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Submit a generation request via /api/generate/v2-web/.
 *
 * payload fields:
 *   - mode: 'custom' | 'simple'
 *   - model: chirp-fenix etc.
 *   - title: song title (required by API even for Simple mode)
 *   - lyrics: Custom-mode lyrics (with [Verse] metatags). Used as API `prompt`.
 *   - tags: Custom-mode style string.
 *   - negativeTags: Custom-mode exclusion tags.
 *   - description: Simple-mode description string. Sent in `prompt` per the
 *     v2-web schema (the older `gpt_description_prompt` field is gone).
 *   - makeInstrumental: bool
 *   - weirdness, styleWeight: 0..1 sliders
 *   - userTier: UUID from billing/info plan.id
 *   - createSessionToken: UUID, generated per session
 *   - deviceId: UUID from local browser
 */
export async function submitSunoGeneration(page, payload) {
    const isCustom = payload.mode === 'custom';
    const body = {
        token: null,
        generation_type: 'TEXT',
        title: payload.title || '',
        tags: isCustom ? (payload.tags || '') : '',
        negative_tags: isCustom ? (payload.negativeTags || '') : '',
        mv: payload.model || DEFAULT_SUNO_MODEL,
        prompt: isCustom ? (payload.lyrics || '') : (payload.description || ''),
        make_instrumental: !!payload.makeInstrumental,
        user_uploaded_images_b64: null,
        metadata: {
            web_client_pathname: '/create',
            is_max_mode: false,
            is_mumble: false,
            create_mode: isCustom ? 'custom' : 'simple',
            user_tier: payload.userTier,
            create_session_token: payload.createSessionToken,
            disable_volume_normalization: false,
            control_sliders: {
                weirdness_constraint: payload.weirdness,
                style_weight: payload.styleWeight,
            },
        },
        override_fields: [],
        cover_clip_id: null,
        cover_start_s: null,
        cover_end_s: null,
        persona_id: null,
        artist_clip_id: null,
        artist_start_s: null,
        artist_end_s: null,
        continue_clip_id: null,
        continued_aligned_prompt: null,
        continue_at: null,
        transaction_uuid: payload.transactionUuid,
        token_provider: null,
    };

    const bodyJson = JSON.stringify(body);
    const deviceId = payload.deviceId;
    const result = unwrapEvaluateResult(await page.evaluate(`(async () => {
        const res = await fetch('${STUDIO_API}/api/generate/v2-web/', {
            method: 'POST',
            headers: ${sunoHeadersJs(deviceId, { 'Content-Type': 'application/json' })},
            body: ${JSON.stringify(bodyJson)},
        });
        const text = await res.text();
        let parsed = null;
        try { parsed = JSON.parse(text); } catch {}
        return { status: res.status, ok: res.ok, body: parsed, raw: parsed ? null : text.slice(0, 600) };
    })()`));

    if (!result || !result.ok) {
        const status = result?.status || 'unknown';
        const detail = result?.body?.detail || result?.raw || JSON.stringify(result?.body || {}).slice(0, 500);
        if (status === 401 || status === 403) {
            throw new AuthRequiredError(SUNO_DOMAIN, `Suno API rejected request (HTTP ${status}). Re-login on suno.com.`);
        }
        if (status === 402) {
            throw new CommandExecutionError(`Suno API: insufficient credits (HTTP 402). ${detail}`);
        }
        throw new CommandExecutionError(`Suno generate failed (HTTP ${status}): ${detail}`);
    }

    if (!result.body || typeof result.body !== 'object' || Array.isArray(result.body)) {
        throw new CommandExecutionError('Suno generate returned malformed JSON payload.');
    }
    const clips = result.body?.clips || [];
    if (!clips.length) {
        throw new EmptyResultError('suno generate', `Submission accepted but Suno returned no clip ids. Raw: ${JSON.stringify(result.body).slice(0, 300)}`);
    }
    return result.body;
}

// ─────────────────────────────────────────────────────────────────────────────
// Poll /api/feed/v3 (cookie auth, no Bearer).
// ─────────────────────────────────────────────────────────────────────────────

export async function pollSunoClips(page, clipIds, timeoutSeconds, deviceId, pollSeconds = 5, onProgress = null) {
    const deadline = Date.now() + timeoutSeconds * 1000;
    const targetSet = new Set(clipIds);
    const idsJson = JSON.stringify(clipIds);

    while (Date.now() < deadline) {
        const result = unwrapEvaluateResult(await page.evaluate(`(async () => {
            const res = await fetch('${STUDIO_API}/api/feed/v3', {
                method: 'POST',
                headers: ${sunoHeadersJs(deviceId, { 'Content-Type': 'application/json' })},
                body: JSON.stringify({ clip_ids: ${idsJson} }),
            });
            const body = await res.json().catch(() => null);
            return { status: res.status, body };
        })()`));

        if (!result) {
            await page.wait(pollSeconds);
            continue;
        }
        if (result.status === 401 || result.status === 403) {
            throw new AuthRequiredError(SUNO_DOMAIN, `Suno feed API rejected (HTTP ${result.status}). Re-login.`);
        }
        if (result.status < 200 || result.status >= 300) {
            throw new CommandExecutionError(`Suno feed API failed while polling clips (HTTP ${result.status || '?'})`);
        }
        if (!result.body || typeof result.body !== 'object' || Array.isArray(result.body)) {
            throw new CommandExecutionError('Suno feed API returned malformed JSON while polling clips');
        }

        const allClips = result.body.clips || [];
        if (!Array.isArray(allClips)) {
            throw new CommandExecutionError('Suno feed API returned malformed clips payload');
        }
        const ourClips = allClips.filter(c => targetSet.has(c.id));
        const finished = ourClips.filter(c => c.status === 'complete' || c.status === 'error');

        if (typeof onProgress === 'function') {
            onProgress({ total: clipIds.length, done: finished.length, statuses: ourClips.map(c => `${c.id.slice(0,8)}:${c.status}`) });
        }

        if (finished.length === clipIds.length) return ourClips;
        await page.wait(pollSeconds);
    }

    throw new TimeoutError(`Suno generation did not complete within ${timeoutSeconds}s. Try --timeout <higher>.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Asset download.
// ─────────────────────────────────────────────────────────────────────────────

function pickMediaUrl(clip, contentTypeFragment) {
    const arr = Array.isArray(clip.media_urls) ? clip.media_urls : [];
    const hit = arr.find(m => (m.content_type || '').toLowerCase().includes(contentTypeFragment));
    return hit?.url || null;
}

/**
 * Resolve the canonical MP3 URL for a clip. Suno's /api/download/clip/{id}
 * returns a fresh signed URL; clip.audio_url is a backup.
 */
async function resolveMp3Url(page, clip, deviceId) {
    const fromApi = await page.evaluate(`(async () => {
        try {
            const res = await fetch('${STUDIO_API}/api/download/clip/${clip.id}?format=mp3', { headers: ${sunoHeadersJs(deviceId)} });
            if (!res.ok) return null;
            const data = await res.json();
            return data?.download_url || null;
        } catch { return null; }
    })()`);
    return fromApi || clip.audio_url || `${SUNO_CDN}/${clip.id}.mp3`;
}

/**
 * Trigger WAV conversion (if not already converted), then poll for the file
 * URL. Suno charges a download credit for WAV — the billing call is required.
 */
async function ensureSunoWav(page, clipId, deviceId, timeoutSeconds = 120, pollSeconds = 3) {
    // Charge the credit + queue conversion. Both calls fire idempotently if
    // the wav is already cached server-side.
    await page.evaluate(`(async () => {
        try {
            await fetch('${STUDIO_API}/api/billing/clips/${clipId}/download/', {
                method: 'POST',
                headers: ${sunoHeadersJs(deviceId, { 'Content-Type': 'application/json' })},
                body: JSON.stringify({}),
            });
        } catch {}
        try {
            await fetch('${STUDIO_API}/api/gen/${clipId}/convert_wav/', {
                method: 'POST',
                headers: ${sunoHeadersJs(deviceId, { 'Content-Type': 'application/json' })},
            });
        } catch {}
    })()`);

    const deadline = Date.now() + timeoutSeconds * 1000;
    while (Date.now() < deadline) {
        const result = unwrapEvaluateResult(await page.evaluate(`(async () => {
            const res = await fetch('${STUDIO_API}/api/gen/${clipId}/wav_file/', { headers: ${sunoHeadersJs(deviceId)} });
            if (!res.ok) return { ok: false, status: res.status };
            const data = await res.json().catch(() => null);
            return { ok: true, url: data?.wav_file_url || null };
        })()`));
        if (result?.ok && result.url) return result.url;
        await page.wait(pollSeconds);
    }
    return null;
}

async function downloadBinary(page, url) {
    // CDN URLs (cdn1.suno.ai, cloudfront) are public and reject the CORS
    // preflight triggered by `credentials: 'include'`. Plain fetch is what
    // the Suno web UI uses for asset downloads too.
    return unwrapEvaluateResult(await page.evaluate(`(async () => {
        try {
            const res = await fetch(${JSON.stringify(url)});
            if (!res.ok) return { ok: false, status: res.status };
            const blob = await res.blob();
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(String(reader.result || ''));
                reader.onerror = () => reject(new Error('reader failed'));
                reader.readAsDataURL(blob);
            });
            return { ok: true, mime: blob.type || '', dataUrl };
        } catch (e) {
            return { ok: false, error: String(e).slice(0, 200) };
        }
    })()`));
}

async function writeFromDataUrl(page, url, filePath) {
    const result = await downloadBinary(page, url);
    if (!result?.ok) {
        return { ok: false, reason: result?.status ? `HTTP ${result.status}` : (result?.error || 'unknown') };
    }
    const base64 = String(result.dataUrl || '').replace(/^data:[^;]+;base64,/, '');
    if (!base64) {
        return { ok: false, reason: 'empty response body' };
    }
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    if (!fs.statSync(filePath).size) {
        return { ok: false, reason: 'empty file written' };
    }
    return { ok: true };
}

export async function downloadSunoClip(page, clip, outputDir, formats, deviceId) {
    ensureDir(outputDir);
    const slug = `${sanitizeTitleForFilename(clip.title || clip.id)}_${clip.id.slice(0, 8)}`;
    const written = [];

    if (formats.includes('metadata')) {
        const metaPath = path.join(outputDir, `${slug}.json`);
        fs.writeFileSync(metaPath, JSON.stringify(clip, null, 2), 'utf8');
        written.push({ format: 'metadata', file: metaPath, ok: true });
    }

    for (const fmt of formats) {
        if (fmt === 'metadata') continue;
        let url = null;
        let ext = '';
        try {
            if (fmt === 'mp3') {
                ext = '.mp3';
                url = await resolveMp3Url(page, clip, deviceId);
            } else if (fmt === 'm4a') {
                ext = '.m4a';
                url = pickMediaUrl(clip, 'm4a');
            } else if (fmt === 'video') {
                ext = '.mp4';
                url = clip.video_url || null;
            } else if (fmt === 'cover') {
                ext = '.jpeg';
                url = clip.image_large_url || clip.image_url || null;
            } else if (fmt === 'wav') {
                ext = '.wav';
                url = await ensureSunoWav(page, clip.id, deviceId);
            }
        } catch (err) {
            written.push({ format: fmt, file: null, ok: false, reason: `prep failed: ${String(err).slice(0, 100)}` });
            continue;
        }
        if (!url) {
            written.push({ format: fmt, file: null, ok: false, reason: 'not available' });
            continue;
        }
        const filePath = path.join(outputDir, `${slug}${ext}`);
        const result = await writeFromDataUrl(page, url, filePath);
        written.push({ format: fmt, file: filePath, ok: result.ok, reason: result.ok ? null : result.reason });
    }

    return { slug, written };
}
