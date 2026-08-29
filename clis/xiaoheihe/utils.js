import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const XIAOHEIHE_BASE = 'https://www.xiaoheihe.cn';
export const BBS_HOME_URL = `${XIAOHEIHE_BASE}/app/bbs/home`;

export const DEFAULT_LIST_LIMIT = 20;
export const MAX_LIST_LIMIT = 50;
export const DEFAULT_COMMENT_LIMIT = 20;
export const MAX_COMMENT_LIMIT = 100;

export function normalizeLimit(raw, defaultValue = DEFAULT_LIST_LIMIT, maxValue = MAX_LIST_LIMIT) {
    if (raw === undefined || raw === null || raw === '') return defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > maxValue) {
        throw new ArgumentError(`--limit must be an integer in [1, ${maxValue}], got ${JSON.stringify(raw)}`);
    }
    return n;
}

export function normalizePostId(raw) {
    const input = String(raw ?? '').trim();
    const fromUrl = input.match(/\/app\/bbs\/link\/(\d+)/)?.[1];
    const fromId = input.match(/^\d+$/)?.[0];
    const postId = fromUrl || fromId;
    if (!postId) {
        throw new ArgumentError(`post must be a xiaoheihe post id or URL, got ${JSON.stringify(raw)}`);
    }
    return postId;
}

export function toPostUrl(postId) {
    return postId ? `${XIAOHEIHE_BASE}/app/bbs/link/${encodeURIComponent(String(postId))}` : '';
}

export function toTopicUrl(topicId) {
    return topicId ? `${XIAOHEIHE_BASE}/app/bbs/topic/${encodeURIComponent(String(topicId))}` : '';
}

export function cleanText(raw) {
    return String(raw ?? '').replace(/\s+/g, ' ').trim();
}

export function formatUnixSeconds(raw) {
    const seconds = Number(raw);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return new Date(seconds * 1000).toISOString();
}

function visitObjectTree(value, visitor, seen = new WeakSet()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    visitor(value);
    if (Array.isArray(value)) {
        for (const item of value) visitObjectTree(item, visitor, seen);
        return;
    }
    for (const child of Object.values(value)) visitObjectTree(child, visitor, seen);
}

function parseRichText(raw, fallback = '') {
    const parts = [];
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (Array.isArray(parsed)) {
            for (const part of parsed) {
                if (typeof part === 'string') {
                    const text = cleanText(part);
                    if (text) parts.push(text);
                    continue;
                }
                if (!part || typeof part !== 'object') continue;
                if (part.type === 'img' && part.url) {
                    parts.push(`[image] ${String(part.url)}`);
                    continue;
                }
                const text = cleanText(part.text);
                if (text && !/^\/storage\//.test(text)) parts.push(text);
            }
        }
    } catch {
        const text = cleanText(raw);
        if (text && !text.startsWith('[{')) parts.push(text);
    }
    if (!parts.length) {
        const text = cleanText(fallback);
        if (text) parts.push(text);
    }
    return parts.join(' ');
}

function appendImages(text, images) {
    const parts = [];
    const base = cleanText(text);
    if (base) parts.push(base);
    if (Array.isArray(images)) {
        for (const image of images) {
            if (image?.url) parts.push(`[image] ${String(image.url)}`);
        }
    }
    return cleanText(parts.join(' '));
}

function mapLinkRow(item, rank) {
    return {
        rank,
        id: String(item.linkid || ''),
        title: cleanText(item.title),
        description: cleanText(item.description),
        author: cleanText(item.user?.username || item.user?.nickname || item.username || ''),
        topic: cleanText((item.topics || [])[0]?.name || (item.content_tags || [])[0]?.text || ''),
        likes: Number(item.link_award_num ?? item.up ?? 0) || 0,
        commentCount: Number(item.comment_num ?? 0) || 0,
        createdAt: formatUnixSeconds(item.create_at),
        url: toPostUrl(item.linkid),
    };
}

export function collectPostLinksFromNuxt(root, limit) {
    const arrays = [];
    visitObjectTree(root, (value) => {
        if (Array.isArray(value?.links)) {
            const usable = value.links.filter((item) => item && typeof item === 'object' && item.linkid && item.title);
            if (usable.length) arrays.push(usable);
        }
    });
    arrays.sort((a, b) => b.length - a.length);
    return (arrays[0] || [])
        .slice(0, limit)
        .map((item, index) => mapLinkRow(item, index + 1))
        .filter((item) => item.id && item.title);
}

export function collectHotPostsFromNuxt(root, limit) {
    return collectPostLinksFromNuxt(root, limit)
        .sort((a, b) => ((b.likes || 0) + (b.commentCount || 0) * 2) - ((a.likes || 0) + (a.commentCount || 0) * 2))
        .slice(0, limit)
        .map((item, index) => ({ ...item, rank: index + 1 }));
}

export function collectTopicsFromNuxt(root, limit) {
    const topicMap = new Map();
    visitObjectTree(root, (value) => {
        if (!value || typeof value !== 'object') return;
        const candidates = [];
        if (Array.isArray(value.subscribed_topics)) candidates.push(...value.subscribed_topics);
        if (Array.isArray(value.top_topics)) candidates.push(...value.top_topics);
        if (Array.isArray(value.topics)) candidates.push(...value.topics);
        for (const topic of candidates) {
            if (!topic || typeof topic !== 'object') continue;
            const id = topic.topic_id ?? topic.id;
            const name = cleanText(topic.name || topic.topic_name);
            if (!name || id === undefined || id === null) continue;
            const key = `${String(id)}:${name}`;
            if (!topicMap.has(key)) {
                topicMap.set(key, {
                    id: String(id),
                    name,
                    hotValue: Number(topic.hot_value_v2 ?? topic.hot_value ?? 0) || 0,
                    icon: String(topic.small_pic_url || topic.pic_url || ''),
                    url: toTopicUrl(id),
                });
            }
        }
    });
    return Array.from(topicMap.values())
        .filter((topic) => topic.id !== '-1')
        .sort((a, b) => b.hotValue - a.hotValue)
        .slice(0, limit)
        .map((topic, index) => ({ rank: index + 1, ...topic }));
}

function findPostResult(root, postId) {
    const candidates = [];
    visitObjectTree(root, (value) => {
        const result = value && typeof value === 'object' ? value.result : null;
        if (!result || typeof result !== 'object') return;
        if (result.link && String(result.link.linkid || '') === String(postId)) {
            candidates.push(result);
        }
    });
    return candidates[0] || null;
}

function collectCommentRows(commentGroups, url, limit) {
    const rows = [];
    for (const group of commentGroups || []) {
        const comments = Array.isArray(group?.comment)
            ? group.comment
            : Array.isArray(group)
                ? group
                : [group];
        for (const comment of comments) {
            if (!comment || typeof comment !== 'object' || !comment.commentid) continue;
            const content = appendImages(parseRichText(comment.text), comment.imgs);
            if (!content) continue;
            rows.push({
                type: 'comment',
                id: String(comment.commentid),
                parentId: comment.replyid ? String(comment.replyid) : null,
                author: cleanText(comment.user?.username || ''),
                replyTo: cleanText(comment.replyuser?.username || ''),
                title: null,
                content,
                likes: Number(comment.up ?? 0) || 0,
                replyCount: Number(comment.child_num ?? 0) || 0,
                createdAt: formatUnixSeconds(comment.create_at),
                ipLocation: cleanText(comment.ip_location || ''),
                url: `${url}#comment-${encodeURIComponent(String(comment.commentid))}`,
            });
            if (rows.length >= limit) return rows;
        }
    }
    return rows;
}

export function collectPostDetailFromNuxt(root, postId, { limit = DEFAULT_COMMENT_LIMIT, includeComments = true } = {}) {
    const result = findPostResult(root, postId);
    if (!result?.link) return [];
    const link = result.link;
    const url = toPostUrl(link.linkid);
    const topic = cleanText((link.topics || [])[0]?.name || (link.content_tags || [])[0]?.text || '');
    const rows = [{
        type: 'post',
        id: String(link.linkid || ''),
        parentId: null,
        author: cleanText(link.user?.username || link.user?.nickname || ''),
        replyTo: null,
        title: cleanText(link.title || ''),
        content: cleanText([topic ? `[${topic}]` : '', parseRichText(link.text, link.description)].join(' ')),
        likes: Number(link.link_award_num ?? link.up ?? 0) || 0,
        replyCount: Number(link.comment_num ?? 0) || 0,
        createdAt: formatUnixSeconds(link.create_at),
        ipLocation: cleanText(link.ip_location || ''),
        url,
    }];
    if (includeComments) {
        rows.push(...collectCommentRows(result.comments, url, limit));
    }
    return rows.filter((row) => row.id && (row.title || row.content));
}

function buildNuxtEvaluateScript(extractorName, args) {
    return `
(() => {
  const XIAOHEIHE_BASE = ${JSON.stringify(XIAOHEIHE_BASE)};
  ${cleanText.toString()}
  ${formatUnixSeconds.toString()}
  ${toPostUrl.toString()}
  ${toTopicUrl.toString()}
  ${visitObjectTree.toString()}
  ${parseRichText.toString()}
  ${appendImages.toString()}
  ${mapLinkRow.toString()}
  ${collectPostLinksFromNuxt.toString()}
  ${collectHotPostsFromNuxt.toString()}
  ${collectTopicsFromNuxt.toString()}
  ${findPostResult.toString()}
  ${collectCommentRows.toString()}
  ${collectPostDetailFromNuxt.toString()}
  const root = window.__NUXT__;
  return ${extractorName}(root, ...${JSON.stringify(args)});
})()
`;
}

export function buildFeedExtractorScript(limit) {
    return buildNuxtEvaluateScript('collectPostLinksFromNuxt', [limit]);
}

export function buildHotExtractorScript(limit) {
    return buildNuxtEvaluateScript('collectHotPostsFromNuxt', [limit]);
}

export function buildTopicsExtractorScript(limit) {
    return buildNuxtEvaluateScript('collectTopicsFromNuxt', [limit]);
}

export function buildPostExtractorScript(postId, limit, includeComments) {
    return buildNuxtEvaluateScript('collectPostDetailFromNuxt', [
        String(postId),
        { limit, includeComments: Boolean(includeComments) },
    ]);
}

export async function gotoBbsHome(page) {
    try {
        await page.goto(BBS_HOME_URL, { waitUntil: 'load', settleMs: 1000 });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new CommandExecutionError(`Failed to open xiaoheihe bbs home: ${message}`);
    }
}

export async function gotoPost(page, rawPost) {
    const id = normalizePostId(rawPost);
    const url = toPostUrl(id);
    try {
        await page.goto(url, { waitUntil: 'load', settleMs: 1000 });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new CommandExecutionError(`Failed to open xiaoheihe post ${id}: ${message}`);
    }
    return { id, url };
}

export async function evaluateWithPolling(page, script, label) {
    let rows = [];
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        rows = await page.evaluate(script);
        if (Array.isArray(rows) && rows.length > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (!Array.isArray(rows) || rows.length === 0) {
        throw new EmptyResultError(label, 'No rows found in xiaoheihe Nuxt state; the page structure may have changed');
    }
    return rows;
}
