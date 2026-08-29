/**
 * Creator-center manuscript metrics from Bilibili's undocumented comparison
 * endpoint. Strategy.COOKIE carries the browser session; the data contract is
 * PAGE_FETCH/internal-unstable and therefore intentionally whitelist-based.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    AuthRequiredError,
    CommandExecutionError,
    EmptyResultError,
    TimeoutError,
} from '@jackwener/opencli/errors';
import { parseBvidOrVideoUrl } from './utils.js';

const MEMBER_ORIGIN = 'https://member.bilibili.com';
const FETCH_TIMEOUT_SECONDS = 15;

// These keys are present in sanitized creator-center probe fixtures. Bilibili
// encodes the selected rate fields as basis points (100 = 1%).
const METRICS = [
    { metric: 'playCount', key: 'play', unit: 'count' },
    { metric: 'likeCount', key: 'like', unit: 'count' },
    { metric: 'commentCount', key: 'comment', unit: 'count' },
    { metric: 'danmakuCount', key: 'dm', unit: 'count' },
    { metric: 'favoriteCount', key: 'fav', unit: 'count' },
    { metric: 'coinCount', key: 'coin', unit: 'count' },
    { metric: 'shareCount', key: 'share', unit: 'count' },
    { metric: 'newFollowerCount', key: 'total_new_attention_cnt', unit: 'count' },
    { metric: 'durationSeconds', key: 'duration', unit: 'seconds', source: 'target' },
    { metric: 'completionPct', key: 'full_play_ratio', unit: 'percent', divisor: 100 },
    { metric: 'activeFollowerViewPct', key: 'active_fans_rate', unit: 'percent', divisor: 100 },
    { metric: 'thumbnailClickPct', key: 'tm_rate', unit: 'percent', divisor: 100 },
    { metric: 'threeSecondExitPct', key: 'crash_rate', unit: 'percent', divisor: 100 },
    { metric: 'interactionPct', key: 'interact_rate', unit: 'percent', divisor: 100 },
    { metric: 'playToFollowerPct', key: 'play_trans_fan_rate', unit: 'percent', divisor: 100 },
];

function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isAuthLike(code, message) {
    return code === -101
        || code === -111
        || /登录|账号未登录|login required|not logged in/i.test(String(message ?? ''));
}

function requirePayload(payload) {
    if (!isRecord(payload) || !Number.isSafeInteger(payload.code)) {
        throw new CommandExecutionError('Bilibili creator comparison API returned a malformed envelope');
    }
    const message = String(payload.message ?? payload.msg ?? 'unknown error');
    if (payload.code !== 0) {
        if (isAuthLike(payload.code, message)) {
            throw new AuthRequiredError('member.bilibili.com', `Bilibili creator-center login is required: ${message}`);
        }
        throw new CommandExecutionError(`Bilibili creator comparison API failed: ${message} (${payload.code})`);
    }
    if (!isRecord(payload.data) || !Array.isArray(payload.data.list)) {
        throw new CommandExecutionError('Bilibili creator comparison API returned malformed list data');
    }
    return payload.data.list;
}

async function fetchComparison(page) {
    try {
        const payload = await page.fetchJson(
            `${MEMBER_ORIGIN}/x/web/data/archive_diagnose/compare?size=100`,
            { timeoutMs: FETCH_TIMEOUT_SECONDS * 1000 },
        );
        return requirePayload(payload);
    }
    catch (error) {
        if (
            error instanceof AuthRequiredError
            || error instanceof EmptyResultError
            || error instanceof CommandExecutionError
            || error instanceof TimeoutError
        ) {
            throw error;
        }
        const detail = `${error?.message ?? error} ${error?.hint ?? ''}`.trim();
        if (/abort|timed?\s*out|timeout/i.test(detail)) {
            throw new TimeoutError('Bilibili creator comparison', FETCH_TIMEOUT_SECONDS);
        }
        if (/HTTP\s+(401|403)|登录|passport|\/login\b/i.test(detail)) {
            throw new AuthRequiredError('member.bilibili.com', `Bilibili creator-center login is required: ${detail}`);
        }
        throw new CommandExecutionError(`Bilibili creator comparison request failed: ${detail}`);
    }
}

function selectTarget(list, bvid) {
    const matches = [];
    for (const item of list) {
        if (!isRecord(item) || typeof item.bvid !== 'string' || !/^BV[0-9A-Za-z]{10}$/.test(item.bvid)) {
            throw new CommandExecutionError('Bilibili creator comparison returned a malformed manuscript row');
        }
        if (item.bvid === bvid) matches.push(item);
    }
    if (matches.length > 1) {
        throw new CommandExecutionError(`Bilibili creator comparison returned duplicate rows for ${bvid}`);
    }
    if (matches.length === 0) {
        throw new EmptyResultError(
            `bilibili creator-stats ${bvid}`,
            'The manuscript was not present in the latest 100 creator analytics rows; it may be older, not owned by this account, or not analyzed yet.',
        );
    }
    const target = matches[0];
    if (!isRecord(target.stat)) {
        throw new CommandExecutionError(`Bilibili creator comparison returned malformed stat data for ${bvid}`);
    }
    return target;
}

function metricValue(target, definition) {
    const source = definition.source === 'target' ? target : target.stat;
    if (!Object.prototype.hasOwnProperty.call(source, definition.key)) {
        throw new CommandExecutionError(`Bilibili creator comparison omitted metric ${definition.key}`);
    }
    const raw = source[definition.key];
    if (raw === null) return null;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
        throw new CommandExecutionError(`Bilibili creator comparison returned malformed metric ${definition.key}`);
    }
    if (definition.unit === 'percent' && raw > 10_000) {
        throw new CommandExecutionError(`Bilibili creator comparison returned out-of-range percentage ${definition.key}`);
    }
    if ((definition.unit === 'count' || definition.unit === 'seconds') && !Number.isSafeInteger(raw)) {
        throw new CommandExecutionError(`Bilibili creator comparison returned non-integer metric ${definition.key}`);
    }
    return definition.divisor ? raw / definition.divisor : raw;
}

cli({
    site: 'bilibili',
    name: 'creator-stats',
    description: '读取当前账号最近稿件的核心创作指标（需登录创作中心）',
    access: 'read',
    example: 'opencli bilibili creator-stats <bvid-or-video-url> -f json',
    domain: 'member.bilibili.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: `${MEMBER_ORIGIN}/platform/home`,
    args: [
        {
            name: 'bvid',
            type: 'string',
            required: true,
            positional: true,
            help: 'Exact case-sensitive BV ID or bilibili.com video URL',
        },
    ],
    columns: ['bvid', 'metric', 'value', 'unit'],
    func: async (page, args) => {
        const bvid = parseBvidOrVideoUrl(args.bvid);
        const target = selectTarget(await fetchComparison(page), bvid);
        const rows = METRICS.map((definition) => ({
            bvid,
            metric: definition.metric,
            value: metricValue(target, definition),
            unit: definition.unit,
        }));
        if (rows.every((row) => row.value === null)) {
            throw new EmptyResultError(
                `bilibili creator-stats ${bvid}`,
                'Bilibili has not generated creator analytics for this manuscript yet.',
            );
        }
        return rows;
    },
});
