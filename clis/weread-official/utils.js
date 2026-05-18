/**
 * WeRead Official Agent Gateway helpers.
 *
 * Auth model: Bearer API key (WEREAD_API_KEY env var, format `wrk-*`).
 * Transport:  pure HTTP, no browser required. Body shape must keep every
 *             business parameter flat alongside `api_name` and `skill_version`
 *             (wrapping them in `params`/`data`/`body` silently breaks the
 *             gateway — see SKILL.md "请求 few-shot").
 *
 * This module is intentionally side-effect free outside `callGateway` so each
 * command file can import only the helpers it needs.
 */
import {
    ArgumentError,
    AuthRequiredError,
    CommandExecutionError,
    EmptyResultError,
    TimeoutError,
} from '@jackwener/opencli/errors';

export const WEREAD_GATEWAY_URL = 'https://i.weread.qq.com/api/agent/gateway';
export const WEREAD_DOMAIN = 'weread.qq.com';

/**
 * Skill version reported with every gateway request. Bump when official
 * `weread-skills.zip` ships a new SKILL.md `version:` line.
 */
export const SKILL_VERSION = '1.0.3';

const DEFAULT_TIMEOUT_MS = 30_000;

/** errcodes that mean "Bearer key invalid / token expired" — map to AuthRequiredError. */
const AUTH_ERRCODES = new Set([-2010, -2012]);

/** Resolve API key from env. Throws AuthRequiredError on missing / blank value. */
export function getApiKey() {
    const key = String(process.env.WEREAD_API_KEY ?? '').trim();
    if (!key) {
        throw new AuthRequiredError(
            WEREAD_DOMAIN,
            'WEREAD_API_KEY is not set. Export it with `export WEREAD_API_KEY=<wrk-...>`.',
        );
    }
    return key;
}

/**
 * Build the gateway request body. Business params are flattened next to
 * `api_name` and `skill_version` — never wrapped in a `params` / `data` /
 * `body` object (the gateway silently drops them and returns page 1).
 */
export function buildGatewayBody(apiName, params = {}) {
    if (!apiName || typeof apiName !== 'string') {
        throw new ArgumentError('weread-official: api_name is required');
    }
    const body = { api_name: apiName, skill_version: SKILL_VERSION };
    for (const [key, value] of Object.entries(params ?? {})) {
        if (value === undefined || value === null || value === '') continue;
        body[key] = value;
    }
    return body;
}

/**
 * POST to the agent gateway. Returns the parsed JSON payload on success.
 * Maps every documented failure mode to a typed CliError:
 *   - missing env key            → AuthRequiredError
 *   - HTTP non-2xx               → CommandExecutionError
 *   - network timeout            → TimeoutError
 *   - response includes upgrade_info → CommandExecutionError (with version hint)
 *   - errcode in AUTH_ERRCODES   → AuthRequiredError (Bearer key likely revoked)
 *   - errcode != 0               → CommandExecutionError
 */
export async function callGateway(apiName, params = {}, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const key = getApiKey();
    const body = buildGatewayBody(apiName, params);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
        response = await fetch(WEREAD_GATEWAY_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
    }
    catch (error) {
        if (error?.name === 'AbortError') {
            throw new TimeoutError(`weread-official ${apiName}`, Math.round(timeoutMs / 1000));
        }
        const detail = error instanceof Error ? error.message : String(error);
        throw new CommandExecutionError(`weread-official ${apiName} request failed`, detail);
    }
    finally {
        clearTimeout(timer);
    }

    if (!response.ok) {
        throw new CommandExecutionError(
            `weread-official ${apiName} HTTP ${response.status}`,
            'Check WeRead gateway availability and that WEREAD_API_KEY is still valid.',
        );
    }

    let payload;
    try {
        payload = await response.json();
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new CommandExecutionError(`weread-official ${apiName} returned invalid JSON`, detail);
    }

    if (payload && typeof payload === 'object' && payload.upgrade_info) {
        const info = payload.upgrade_info;
        const required = info?.required_version ?? info?.version ?? 'unknown';
        const message = info?.message ?? 'WeRead skill version is outdated';
        throw new CommandExecutionError(
            `WeRead skill 需升级: ${message}. Required skill_version=${required}, current=${SKILL_VERSION}`,
            'Pull the latest weread-skills.zip and bump SKILL_VERSION in clis/weread-official/utils.js.',
        );
    }

    const errcode = Number(payload?.errcode ?? 0);
    if (errcode !== 0) {
        const errmsg = String(payload?.errmsg ?? 'unknown error');
        if (AUTH_ERRCODES.has(errcode)) {
            throw new AuthRequiredError(
                WEREAD_DOMAIN,
                `WEREAD_API_KEY rejected (errcode=${errcode}, ${errmsg}). Regenerate the key and re-export it.`,
            );
        }
        throw new CommandExecutionError(
            `weread-official ${apiName} returned errcode=${errcode}`,
            errmsg,
        );
    }

    return payload;
}

// ── Formatting helpers ──────────────────────────────────────────────────────

/** Unix timestamp (sec) → YYYY-MM-DD using UTC for stable test snapshots. */
export function formatDate(ts) {
    const seconds = Number(ts);
    if (!Number.isFinite(seconds) || seconds <= 0) return '';
    const date = new Date(seconds * 1000);
    if (Number.isNaN(date.getTime())) return '';
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** Seconds → "X小时Y分钟" (or "Y分钟" if no hours, "0分钟" if < 1 minute). */
export function formatDuration(secs) {
    if (secs === null || secs === undefined || secs === '') return '';
    const total = Number(secs);
    if (!Number.isFinite(total) || total < 0) return '';
    const seconds = Math.floor(total);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}小时${minutes}分钟`;
    return `${minutes}分钟`;
}

/**
 * WeRead `star` field uses multiples of 20 (20=1⭐, 40=2⭐, …, 100=5⭐).
 * `-1` and `0` both mean "no rating".
 */
export function formatStar(star) {
    const value = Number(star);
    if (!Number.isFinite(value) || value <= 0) return '无评分';
    const count = Math.min(5, Math.floor(value / 20));
    if (count <= 0) return '无评分';
    return '⭐'.repeat(count);
}

/**
 * WeRead book rating uses a 0-1000 scale (1000 = 100%). Returns a short label
 * with the canonical tier names from the official skill output examples.
 */
export function formatRating(rating) {
    const value = Number(rating);
    if (!Number.isFinite(value) || value <= 0) return '暂无';
    const percent = value / 10;
    if (percent >= 90) return `神作 ${Math.round(percent)}%`;
    if (percent >= 80) return `力荐 ${Math.round(percent)}%`;
    if (percent >= 70) return `好评 ${Math.round(percent)}%`;
    return `${percent.toFixed(1)}分`;
}

/** Truncate text to `maxLen` chars with an ellipsis suffix. Returns '' for nullish. */
export function truncate(text, maxLen = 200) {
    const value = String(text ?? '');
    if (!value) return '';
    if (value.length <= maxLen) return value;
    return `${value.slice(0, maxLen)}…`;
}

// ── Deep links ──────────────────────────────────────────────────────────────

/**
 * Build a `weread://` deep link.
 *  - bookId only                                 → open at last reading position
 *  - bookId + chapterUid                         → open chapter
 *  - bookId + chapterUid + rangeStart + rangeEnd → open bestbookmark position
 */
export function makeDeepLink({ bookId, chapterUid = '', rangeStart = '', rangeEnd = '', userVid = '' } = {}) {
    const bid = String(bookId ?? '').trim();
    if (!bid) return '';
    const chapter = String(chapterUid ?? '').trim();
    const start = String(rangeStart ?? '').trim();
    const end = String(rangeEnd ?? '').trim();
    if (chapter && start && end) {
        const params = new URLSearchParams({ bookId: bid, chapterUid: chapter, rangeStart: start, rangeEnd: end });
        const vid = String(userVid ?? '').trim();
        if (vid) params.set('userVid', vid);
        return `weread://bestbookmark?${params.toString()}`;
    }
    if (chapter) return `weread://reading?bId=${bid}&chapterUid=${chapter}`;
    return `weread://reading?bId=${bid}`;
}

/**
 * Split a WeRead `range` field ("900-2004") into `{rangeStart, rangeEnd}`.
 * Returns empty strings when the input is missing/malformed.
 */
export function parseRange(range) {
    const text = String(range ?? '').trim();
    const match = text.match(/^(\d+)-(\d+)$/);
    if (!match) return { rangeStart: '', rangeEnd: '' };
    return { rangeStart: match[1], rangeEnd: match[2] };
}

// ── Argument validation ─────────────────────────────────────────────────────

export function requireText(value, label) {
    const text = String(value ?? '').trim();
    if (!text) throw new ArgumentError(`weread-official: ${label} cannot be empty`);
    return text;
}

export function requireBookId(value, label = 'bookId') {
    const text = requireText(value, label);
    if (!/^[A-Za-z0-9_-]+$/.test(text)) {
        throw new ArgumentError(`weread-official: ${label} contains invalid characters`, 'Pass a bookId from `weread-official search`.');
    }
    return text;
}

export function requirePositiveInt(value, label, { defaultValue, max } = {}) {
    if (value === undefined || value === null || value === '') {
        if (defaultValue === undefined) {
            throw new ArgumentError(`weread-official: ${label} is required`);
        }
        return defaultValue;
    }
    const text = String(value).trim();
    if (!/^\d+$/.test(text)) {
        throw new ArgumentError(`weread-official: ${label} must be a positive integer`);
    }
    const n = Number(text);
    if (!Number.isSafeInteger(n) || n < 1) {
        throw new ArgumentError(`weread-official: ${label} must be a positive integer`);
    }
    if (max !== undefined && n > max) {
        throw new ArgumentError(`weread-official: ${label} must be <= ${max}`);
    }
    return n;
}

export function requireChoice(value, choices, label, defaultValue) {
    const text = String(value ?? defaultValue ?? '').trim();
    if (!choices.includes(text)) {
        throw new ArgumentError(`weread-official: ${label} must be one of: ${choices.join(', ')}`);
    }
    return text;
}

// ── Empty-result helper ────────────────────────────────────────────────────

/** Throw EmptyResultError with a stable command label. */
export function emptyResult(command, hint) {
    throw new EmptyResultError(`weread-official ${command}`, hint);
}
