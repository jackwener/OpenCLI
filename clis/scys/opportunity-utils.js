import { ArgumentError } from '@jackwener/opencli/errors';
const FLAG_SET = new Set(['中标', '热门', '信息差', '新玩法', '市场洞察', '风向标']);
export function normalizeOpportunityTab(input) {
    const raw = String(input ?? '').trim().toLowerCase();
    if (!raw || raw === 'all' || raw === '全部')
        return { key: 'all', label: '全部' };
    if (raw === 'hot' || raw === '热门')
        return { key: 'hot', label: '热门' };
    if (raw === 'winning' || raw === 'win' || raw === 'zhongbiao' || raw === '中标') {
        return { key: 'winning', label: '中标' };
    }
    throw new ArgumentError(`Unsupported tab: ${String(input)}`, 'Use one of: all/全部, hot/热门, winning/中标');
}
export function splitOpportunityFlagsAndTags(values) {
    const cleaned = values.map((v) => String(v || '').trim()).filter(Boolean);
    const flags = Array.from(new Set(cleaned.filter((v) => FLAG_SET.has(v))));
    const tags = Array.from(new Set(cleaned.filter((v) => !FLAG_SET.has(v))));
    return { flags, tags };
}
export function buildScysTopicLink(entityType, entityId) {
    const type = String(entityType ?? '').trim();
    const id = String(entityId ?? '').trim();
    if (!type || !id)
        return '';
    return `https://scys.com/articleDetail/${encodeURIComponent(type)}/${encodeURIComponent(id)}`;
}
export function inferTopicIdFromImageUrls(urls) {
    if (!Array.isArray(urls))
        return '';
    for (const raw of urls) {
        const text = String(raw || '');
        const m = text.match(/\/images\/(\d{8,})\//);
        if (m?.[1])
            return m[1];
    }
    return '';
}
export function parseAiSummaryText(input) {
    return stripScysRichText(input);
}
function decodeUriSafe(value) {
    try {
        return decodeURIComponent(value);
    }
    catch {
        return value;
    }
}
/**
 * SCYS 富文本常见格式:
 * - <e type="hashtag" title="%23xxxx%23" />
 * - 常规 HTML 标签 <p>/<strong>/...
 */
export function stripScysRichText(input) {
    const raw = String(input ?? '');
    if (!raw)
        return '';
    const withHashtagText = raw.replace(/<e\b[^>]*\btitle="([^"]+)"[^>]*\/?>/gi, (_full, title) => ` ${decodeUriSafe(title)} `);
    return withHashtagText
        .replace(/<e\b[^>]*\/?>/gi, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/\s+/g, ' ')
        .trim();
}
export function formatScysRelativeTime(tsSeconds, nowMs = Date.now()) {
    const ts = Number(tsSeconds);
    if (!Number.isFinite(ts) || ts <= 0)
        return '';
    const targetMs = ts * 1000;
    const deltaSec = Math.floor((nowMs - targetMs) / 1000);
    if (deltaSec < 0)
        return '';
    if (deltaSec < 60)
        return '刚刚';
    if (deltaSec < 3600)
        return `${Math.max(1, Math.floor(deltaSec / 60))}分钟前`;
    if (deltaSec < 86400)
        return `${Math.max(1, Math.floor(deltaSec / 3600))}小时前`;
    if (deltaSec < 86400 * 30)
        return `${Math.max(1, Math.floor(deltaSec / 86400))}天前`;
    const d = new Date(targetMs);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
