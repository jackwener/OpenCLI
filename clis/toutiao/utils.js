/**
 * Shared helpers for the toutiao adapter.
 */
import { ArgumentError } from '@jackwener/opencli/errors';

const ARTICLES_MIN_PAGE = 1;
const ARTICLES_MAX_PAGE = 4;
const HOT_MIN_LIMIT = 1;
const HOT_MAX_LIMIT = 50;

export function parseArticlesPage(raw, fallback = 1) {
    if (raw === undefined || raw === null || raw === '') return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        throw new ArgumentError(`--page must be an integer between ${ARTICLES_MIN_PAGE} and ${ARTICLES_MAX_PAGE}, got ${JSON.stringify(raw)}`);
    }
    if (parsed < ARTICLES_MIN_PAGE || parsed > ARTICLES_MAX_PAGE) {
        throw new ArgumentError(`--page must be between ${ARTICLES_MIN_PAGE} and ${ARTICLES_MAX_PAGE}, got ${parsed}`);
    }
    return parsed;
}

export function parseHotLimit(raw, fallback = 30) {
    if (raw === undefined || raw === null || raw === '') return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        throw new ArgumentError(`--limit must be an integer between ${HOT_MIN_LIMIT} and ${HOT_MAX_LIMIT}, got ${JSON.stringify(raw)}`);
    }
    if (parsed < HOT_MIN_LIMIT || parsed > HOT_MAX_LIMIT) {
        throw new ArgumentError(`--limit must be between ${HOT_MIN_LIMIT} and ${HOT_MAX_LIMIT}, got ${parsed}`);
    }
    return parsed;
}

const NON_TITLE_LINES = new Set([
    '展现', '阅读', '点赞', '评论',
    '查看数据', '查看评论', '修改', '更多', '首发',
    '已发布', '定时发布', '定时发布中', '由文章生成', '审核中',
]);

const STATS_RE = /展现\s*([\d,]+)\s*阅读\s*([\d,]+)\s*点赞\s*([\d,]+)\s*评论\s*([\d,]*)/;

/**
 * Extract creator-backend article rows from the rendered text dump.
 *
 * Surfaces every row anchored on a `MM-DD HH:MM` line; if the matching stats
 * line never came through (slow render / missing element), the row is still
 * emitted with `null` for stat columns rather than silently dropped.
 */
export function parseToutiaoArticlesText(text) {
    const lines = String(text || '').split('\n').map((line) => line.trim()).filter(Boolean);
    const results = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!/^\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(line)) continue;

        const date = line;
        let title = null;
        let status = null;
        let stats = null;

        for (let back = 3; back >= 1; back--) {
            const prev = lines[i - back] || '';
            if (!prev || prev.length >= 100 || /^\d+$/.test(prev) || NON_TITLE_LINES.has(prev)) continue;
            title = prev;
            break;
        }

        for (let fwd = 1; fwd < 8; fwd++) {
            const fwdLine = lines[i + fwd] || '';
            if (fwdLine === '已发布' || fwdLine === '定时发布中' || fwdLine === '审核中' || fwdLine === '由文章生成') {
                status = fwdLine;
            }
            if (fwdLine.includes('展现') && fwdLine.includes('阅读')) {
                const match = fwdLine.match(STATS_RE);
                if (match) {
                    stats = {
                        '展现': match[1],
                        '阅读': match[2],
                        '点赞': match[3],
                        '评论': match[4] || '0',
                    };
                }
            }
        }

        if (!title) continue;

        if (stats) {
            results.push({ title, date, status, ...stats });
        } else {
            // Surface partial rows so callers can see they exist (was previously
            // silently dropped — masking creator-backend slow-render bugs).
            results.push({
                title,
                date,
                status,
                '展现': null,
                '阅读': null,
                '点赞': null,
                '评论': null,
            });
        }
    }

    return results;
}

function trimOrNull(v) {
    const s = String(v ?? '').trim();
    return s ? s : null;
}

function pickImage(item) {
    const url = item?.Image?.url;
    if (typeof url === 'string' && url) return url;
    const firstFromList = Array.isArray(item?.Image?.url_list)
        ? item.Image.url_list
            .map((entry) => typeof entry === 'string' ? entry : entry?.url)
            .find((u) => typeof u === 'string' && u)
        : null;
    return firstFromList || null;
}

function parseHot(v) {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Project a row from the public toutiao hot-board API into stable shape.
 */
export function mapHotRow(item, index) {
    if (!item || typeof item !== 'object') return null;
    const groupId = trimOrNull(item.ClusterIdStr || (item.ClusterId != null ? String(item.ClusterId) : null));
    const title = trimOrNull(item.Title);
    if (!title) return null;
    return {
        rank: index + 1,
        group_id: groupId,
        title,
        query: trimOrNull(item.QueryWord) || title,
        hot_value: parseHot(item.HotValue),
        label: trimOrNull(item.Label),
        url: trimOrNull(item.Url),
        image_url: pickImage(item),
    };
}

export const HOT_BOARD_URL = 'https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc';

export function looksToutiaoAuthWallText(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!text) return false;
    return /登录|请登录|账号登录|扫码登录|安全验证|验证码|captcha/.test(text) ||
        /\b(login|sign in|captcha|verification required)\b/.test(text) ||
        /mp\.toutiao\.com\/profile_v4\/login/.test(text);
}

export const __test__ = { ARTICLES_MIN_PAGE, ARTICLES_MAX_PAGE, HOT_MIN_LIMIT, HOT_MAX_LIMIT };
