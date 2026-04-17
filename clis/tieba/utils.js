import { createHash } from 'node:crypto';
/**
 * Shared Tieba parsing helpers used by the browser adapters.
 */
export const MAX_TIEBA_LIMIT = 20;
const TIEBA_PC_SIGN_SALT = '36770b1f34c9bbf2e7d1a99d2b82fa9e';
const TIEBA_TIME_ZONE = 'Asia/Shanghai';
/**
 * Keep the public CLI limit contract aligned with the real implementation.
 */
export function normalizeTiebaLimit(value, fallback = MAX_TIEBA_LIMIT) {
    const parsed = Number(value ?? fallback);
    if (!Number.isFinite(parsed) || parsed < 1)
        return fallback;
    return Math.min(Math.trunc(parsed), MAX_TIEBA_LIMIT);
}
export function normalizeText(value) {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}
/**
 * Match Tieba PC's signed request contract so forum list fetching stays stable.
 */
export function signTiebaPcParams(params) {
    const payload = Object.keys(params)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => `${key}=${params[key]}`)
        .join('') + TIEBA_PC_SIGN_SALT;
    return createHash('md5').update(payload).digest('hex');
}
export function parseTiebaCount(text) {
    const value = normalizeText(text).toUpperCase();
    if (!value)
        return 0;
    const compact = value.replace(/[^\d.W万]/g, '');
    if (compact.endsWith('万')) {
        return Math.round(parseFloat(compact.slice(0, -1)) * 10000);
    }
    if (compact.endsWith('W')) {
        return Math.round(parseFloat(compact.slice(0, -1)) * 10000);
    }
    return parseInt(compact.replace(/[^\d]/g, ''), 10) || 0;
}
export function parseTiebaLastReply(text) {
    const normalized = normalizeText(text).replace(/^回复于/, '').trim();
    const match = normalized.match(/(刚刚|\d+\s*(?:分钟|小时|天)前|\d{2}-\d{2}(?:\s+\d{2}:\d{2})?|\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?)/);
    return match ? match[1].trim() : normalized;
}
function buildTiebaThreadUrl(id, rawUrl) {
    const explicitUrl = normalizeText(rawUrl);
    if (explicitUrl)
        return explicitUrl;
    return id ? `https://tieba.baidu.com/p/${id}` : '';
}
function resolveTiebaThreadId(raw) {
    const direct = normalizeText(raw.threadId);
    if (direct)
        return direct;
    const fromUrl = normalizeText(raw.url).match(/\/p\/(\d+)/);
    return fromUrl ? fromUrl[1] : '';
}
function getTiebaFeedComponent(feed, name) {
    const components = Array.isArray(feed?.components) ? feed.components : [];
    const match = components.find((entry) => normalizeText(entry.component) === name);
    if (!match)
        return {};
    const payload = match[name];
    return payload && typeof payload === 'object' ? payload : {};
}
function extractTiebaFeedAuthor(feed) {
    const head = getTiebaFeedComponent(feed, 'feed_head');
    const mainData = Array.isArray(head.main_data) ? head.main_data : [];
    for (const item of mainData) {
        const textRecord = item.text;
        const author = normalizeText(textRecord?.text);
        if (author)
            return author;
    }
    return '';
}
function extractTiebaFeedTitle(feed) {
    const title = getTiebaFeedComponent(feed, 'feed_title');
    const titleData = Array.isArray(title.data) ? title.data : [];
    const firstTitle = titleData[0];
    const textInfo = firstTitle?.text_info;
    return normalizeText(textInfo?.text) || normalizeText(feed?.business_info_map?.title);
}
function extractTiebaFeedCommentCount(feed) {
    const social = getTiebaFeedComponent(feed, 'feed_social');
    const commentCount = Number(social.comment_num ?? feed?.business_info_map?.comment_num ?? 0);
    return Number.isFinite(commentCount) ? commentCount : 0;
}
function extractTiebaFeedThreadId(feed) {
    const direct = normalizeText(feed?.business_info_map?.thread_id);
    if (direct)
        return direct;
    const logParams = Array.isArray(feed?.log_param) ? feed.log_param : [];
    const fromLog = normalizeText(logParams.find((item) => normalizeText(item?.key) === 'tid')?.value);
    if (fromLog)
        return fromLog;
    const fromSchema = normalizeText(feed?.schema).match(/[?&]tid=(\d+)/);
    return fromSchema ? fromSchema[1] : '';
}
function extractTiebaFeedLastReply(feed) {
    const head = getTiebaFeedComponent(feed, 'feed_head');
    const extraData = Array.isArray(head.extra_data) ? head.extra_data : [];
    const first = extraData[0];
    const prefix = normalizeText(first?.business_info_map?.time_prefix);
    const textRecord = first?.text;
    const rawTime = normalizeText(textRecord?.text);
    const formattedTime = /^\d+$/.test(rawTime) ? formatTiebaUnixTime(rawTime) : rawTime;
    return [prefix, formattedTime].filter(Boolean).join('');
}
/**
 * Convert Tieba's signed `page_pc` feed entries into the stable card shape used by the CLI.
 */
export function buildTiebaPostCardsFromPagePc(rawFeeds) {
    return rawFeeds
        .filter((entry) => normalizeText(entry.layout) === 'feed' && entry.feed)
        .map((entry) => {
        const feed = entry.feed;
        const threadId = extractTiebaFeedThreadId(feed);
        return {
            title: extractTiebaFeedTitle(feed),
            author: extractTiebaFeedAuthor(feed),
            descInfo: extractTiebaFeedLastReply(feed),
            commentCount: extractTiebaFeedCommentCount(feed),
            actionTexts: [],
            threadId,
            url: buildTiebaThreadUrl(threadId),
        };
    })
        .filter((entry) => normalizeText(entry.title));
}
export function buildTiebaPostItems(rawCards, requestedLimit) {
    const limit = normalizeTiebaLimit(requestedLimit);
    return rawCards
        .map((raw) => {
        const title = normalizeText(raw.title);
        const id = resolveTiebaThreadId(raw);
        const actionTexts = Array.isArray(raw.actionTexts) ? raw.actionTexts.map(normalizeText).filter(Boolean) : [];
        const commentText = actionTexts.find((text) => /评论/.test(text)) || actionTexts[actionTexts.length - 1] || '';
        return {
            title,
            author: normalizeText(raw.author),
            replies: Number.isFinite(Number(raw.commentCount))
                ? Number(raw.commentCount)
                : parseTiebaCount(commentText),
            last_reply: parseTiebaLastReply(String(raw.descInfo ?? '')),
            id,
            url: buildTiebaThreadUrl(id, raw.url),
        };
    })
        .filter((item) => item.title)
        .slice(0, limit)
        .map((item, index) => ({ rank: index + 1, ...item }));
}
export function buildTiebaSearchItems(rawItems, requestedLimit) {
    const limit = normalizeTiebaLimit(requestedLimit);
    return rawItems
        .map((raw) => {
        const url = normalizeText(raw.url);
        const directId = normalizeText(raw.id);
        const idFromUrl = url.match(/\/p\/(\d+)/)?.[1] || '';
        return {
            title: normalizeText(raw.title),
            forum: normalizeText(raw.forum),
            author: normalizeText(raw.author),
            time: normalizeText(raw.time),
            snippet: normalizeText(raw.snippet).slice(0, 200),
            id: directId || idFromUrl,
            url,
        };
    })
        .filter((item) => item.title)
        .slice(0, limit)
        .map((item, index) => ({ rank: index + 1, ...item }));
}
function formatTiebaUnixTime(value) {
    const ts = Number(value || 0);
    if (!Number.isFinite(ts) || ts <= 0)
        return '';
    const parts = new Intl.DateTimeFormat('sv-SE', {
        timeZone: TIEBA_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(new Date(ts * 1000));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`;
}
function parseTiebaReplyTime(text) {
    const normalized = normalizeText(text);
    const withoutFloor = normalized.replace(/^第\d+楼\s+/, '').trim();
    const match = withoutFloor.match(/^(刚刚|昨天|前天|\d+\s*(?:分钟|小时|天)前|\d{2}-\d{2}(?:\s+\d{2}:\d{2})?|\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?)/);
    return match ? match[1].trim() : withoutFloor;
}
function buildMainPostItem(mainPost) {
    if (!mainPost)
        return null;
    const title = normalizeText(mainPost.title);
    const author = normalizeText(mainPost.author) || normalizeText(mainPost.fallbackAuthor);
    const body = normalizeText(mainPost.contentText) || normalizeText(mainPost.structuredText);
    const hasMedia = Boolean(mainPost.hasMedia);
    const content = [title, body || (hasMedia ? '[media]' : '')].filter(Boolean).join(' ').trim();
    if (!content)
        return null;
    return {
        floor: 1,
        author,
        content,
        time: normalizeText(mainPost.visibleTime) || formatTiebaUnixTime(mainPost.structuredTime),
    };
}
export function buildTiebaReadItems(payload, options = {}) {
    const fallback = Number.isFinite(Number(options.limit)) ? Number(options.limit) : 30;
    const limit = Math.max(1, Math.trunc(fallback));
    const includeMainPost = options.includeMainPost !== false;
    const items = [];
    const mainPost = buildMainPostItem(payload.mainPost);
    if (includeMainPost && mainPost)
        items.push(mainPost);
    const replies = Array.isArray(payload.replies) ? payload.replies : [];
    const replyItems = [];
    for (const reply of replies) {
        const floor = Number(reply.floor || 0);
        const content = normalizeText(reply.content);
        if (!Number.isFinite(floor) || floor < 1 || !content)
            continue;
        replyItems.push({
            floor,
            author: normalizeText(reply.author),
            content,
            time: parseTiebaReplyTime(String(reply.time ?? '')),
        });
    }
    return items.concat(replyItems.slice(0, limit));
}
