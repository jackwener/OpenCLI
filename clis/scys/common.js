import { ArgumentError } from '@jackwener/opencli/errors';
const SCYS_ORIGIN = 'https://scys.com';
export function normalizeScysUrl(input) {
    const raw = String(input ?? '').trim();
    if (!raw) {
        throw new ArgumentError('SCYS URL is required');
    }
    if (/^https?:\/\//i.test(raw)) {
        return raw;
    }
    if (raw.startsWith('/')) {
        return `${SCYS_ORIGIN}${raw}`;
    }
    if (raw.startsWith('scys.com')) {
        return `https://${raw}`;
    }
    return `${SCYS_ORIGIN}/${raw.replace(/^\/+/, '')}`;
}
export function toScysCourseUrl(input) {
    const raw = String(input ?? '').trim();
    if (!raw)
        throw new ArgumentError('Course URL or course id is required');
    if (/^\d+$/.test(raw)) {
        return `${SCYS_ORIGIN}/course/detail/${raw}`;
    }
    return normalizeScysUrl(raw);
}
export function toScysArticleUrl(input) {
    const raw = String(input ?? '').trim();
    if (!raw)
        throw new ArgumentError('Article URL is required');
    if (/^\d{8,}$/.test(raw)) {
        return `${SCYS_ORIGIN}/articleDetail/xq_topic/${raw}`;
    }
    const url = normalizeScysUrl(raw);
    const parsed = new URL(url);
    const match = parsed.pathname.match(/^\/articleDetail\/([^/]+)\/([^/]+)$/);
    if (!match) {
        throw new ArgumentError(`Unsupported SCYS article URL: ${input}`, 'Use /articleDetail/<entityType>/<topicId> or pass a numeric topic id');
    }
    return url;
}
export function detectScysPageType(input) {
    const url = new URL(normalizeScysUrl(input));
    const pathname = url.pathname;
    if (pathname.startsWith('/course/detail/'))
        return 'course';
    if (pathname.startsWith('/opportunity'))
        return 'opportunity';
    if (pathname.startsWith('/activity/landing/'))
        return 'activity';
    if (/^\/articleDetail\/[^/]+\/[^/]+$/.test(pathname))
        return 'article';
    if (pathname.startsWith('/personal/')) {
        const tab = (url.searchParams.get('tab') || '').toLowerCase();
        if (tab === 'posts')
            return 'feed';
    }
    if (pathname === '/' || pathname === '') {
        const filter = (url.searchParams.get('filter') || '').toLowerCase();
        if (filter === 'essence')
            return 'feed';
    }
    return 'unknown';
}
export function extractScysCourseId(input) {
    const url = new URL(toScysCourseUrl(input));
    const match = url.pathname.match(/\/course\/detail\/(\d+)/);
    return match?.[1] ?? '';
}
export function extractScysArticleMeta(input) {
    const url = new URL(toScysArticleUrl(input));
    const match = url.pathname.match(/^\/articleDetail\/([^/]+)\/([^/]+)$/);
    return {
        entityType: match?.[1] ?? '',
        topicId: match?.[2] ?? '',
    };
}
export function cleanText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}
export function extractInteractions(raw) {
    const text = cleanText(raw);
    if (!text)
        return '';
    const pieces = text.match(/[0-9]+(?:\.[0-9]+)?(?:万|亿)?/g);
    if (!pieces || pieces.length === 0)
        return text;
    return pieces.join(' ');
}
export function inferScysReadUrl(input) {
    return normalizeScysUrl(input);
}
export function buildScysHomeEssenceUrl() {
    return `${SCYS_ORIGIN}/?filter=essence`;
}
export function buildScysOpportunityUrl() {
    return `${SCYS_ORIGIN}/opportunity`;
}
