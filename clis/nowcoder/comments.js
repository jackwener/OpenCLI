/**
 * Nowcoder comment mining — fetch top-level comments and optionally expand
 * structured reply threads from the public Sparta API.
 *
 * Entity types used by the comment API:
 *   250 = discussion post, 74 = moment, 2 = replies under a comment.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const API_BASE = 'https://gw-c.nowcoder.com';
const COMMAND = 'nowcoder comments';
const COMMENT_PAGE_SIZE = 20;
const MAX_COMMENT_PAGE_REQUESTS = 100;
const MAX_TOP_LEVEL_LIMIT = 100;
const MAX_REPLIES_LIMIT = 100;
const REPLY_CONCURRENCY = 4;
const REQUEST_TIMEOUT_MS = 15_000;
const ORDER_VALUES = {
    new: 0,
    default: 1,
    hot: 2,
};
const SORT_VALUES = new Set(['thread', 'likes', 'replies', 'direct-replies', 'time']);

function requireInteger(raw, name, { fallback, min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
    const value = Number(raw ?? fallback);
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new ArgumentError(`${COMMAND} ${name} must be an integer between ${min} and ${max}`);
    }
    return value;
}

function parseOrder(raw) {
    const order = String(raw ?? 'default').trim().toLowerCase();
    if (!Object.hasOwn(ORDER_VALUES, order)) {
        throw new ArgumentError(`${COMMAND} order must be one of: default, new, hot`);
    }
    return ORDER_VALUES[order];
}

function parseSort(raw) {
    const sort = String(raw ?? 'thread').trim().toLowerCase();
    if (!SORT_VALUES.has(sort)) {
        throw new ArgumentError(`${COMMAND} sort must be one of: thread, likes, replies, direct-replies, time`);
    }
    return sort;
}

function parseTarget(raw) {
    const value = String(raw ?? '').trim();
    if (!value) {
        throw new ArgumentError(`${COMMAND} requires a post ID, moment UUID, or URL`);
    }

    if (/^\d+$/.test(value)) {
        return { kind: 'numeric', value };
    }
    if (/^[a-f\d]{32}$/i.test(value)) {
        return { kind: 'moment', value: value.toLowerCase() };
    }

    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new ArgumentError(`${COMMAND} target must be a numeric ID, 32-character moment UUID, or nowcoder.com URL`);
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.port
        || (url.hostname !== 'www.nowcoder.com' && url.hostname !== 'nowcoder.com')) {
        throw new ArgumentError(`${COMMAND} only accepts https://nowcoder.com URLs`);
    }

    const discussMatch = url.pathname.match(/^\/discuss\/(\d+)(?:\/|$)/);
    if (discussMatch) {
        return { kind: 'discussion', value: discussMatch[1] };
    }
    const momentMatch = url.pathname.match(/^\/feed\/main\/detail\/([a-f\d]{32}|\d+)(?:\/|$)/i);
    if (momentMatch) {
        const momentId = momentMatch[1].toLowerCase();
        return { kind: /^\d+$/.test(momentId) ? 'moment-entity' : 'moment', value: momentId };
    }
    throw new ArgumentError('Unsupported Nowcoder URL; expected /discuss/<id> or /feed/main/detail/<uuid-or-id>');
}

async function fetchNowcoder(path, label, { allowMissing = false } = {}) {
    let response;
    try {
        response = await fetch(`${API_BASE}${path}`, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    }
    catch (error) {
        throw new CommandExecutionError(
            `Nowcoder ${label} request failed: ${error instanceof Error ? error.message : String(error)}`,
            'Try again later or rerun with -v for more detail.',
        );
    }
    if (!response.ok) {
        throw new CommandExecutionError(`Nowcoder ${label} request failed (HTTP ${response.status})`);
    }

    let payload;
    try {
        payload = await response.json();
    }
    catch (error) {
        throw new CommandExecutionError(
            `Nowcoder ${label} returned malformed JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new CommandExecutionError(`Nowcoder ${label} returned a malformed payload`);
    }
    if (!payload.success || payload.code !== 0) {
        if (allowMissing && (payload.code === -1 || payload.code === 1)) return null;
        throw new CommandExecutionError(`Nowcoder ${label} API failed: ${payload.msg || 'unknown error'} (${payload.code ?? 'unknown'})`);
    }
    return payload.data;
}

function normalizeId(value) {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
    if (typeof value === 'string' && /^\d+$/.test(value)) return value;
    return '';
}

async function resolveCommentEntity(target) {
    if (target.kind === 'discussion') {
        return { entityId: target.value, entityType: 250 };
    }
    if (target.kind === 'moment-entity') {
        return { entityId: target.value, entityType: 74 };
    }

    if (target.kind === 'moment') {
        const data = await fetchNowcoder(
            `/api/sparta/detail/moment-data/detail/${encodeURIComponent(target.value)}`,
            'moment detail',
            { allowMissing: true },
        );
        const entityId = normalizeId(data?.entityId ?? data?.id);
        if (entityId) return { entityId, entityType: 74 };
        throw new EmptyResultError(
            COMMAND,
            `No Nowcoder moment found for ${target.value}. Discussion posts require their numeric /discuss/<id> ID.`,
        );
    }

    const content = await fetchNowcoder(
        `/api/sparta/detail/content-data/detail/${encodeURIComponent(target.value)}`,
        'discussion detail',
        { allowMissing: true },
    );
    const contentEntityId = normalizeId(content?.entityId);
    if (contentEntityId) return { entityId: contentEntityId, entityType: 250 };
    return { entityId: target.value, entityType: 74 };
}

function normalizePlainText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function stripHtml(value) {
    return String(value ?? '')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&amp;/gi, '&')
        .replace(/\s+/g, ' ')
        .trim();
}

function commentText(comment) {
    if (typeof comment?.pureText === 'string' && comment.pureText.trim()) {
        return normalizePlainText(comment.pureText);
    }
    if (typeof comment?.contentV2 === 'string') {
        try {
            const content = JSON.parse(comment.contentV2);
            if (typeof content?.pureText === 'string' && content.pureText.trim()) {
                return normalizePlainText(content.pureText);
            }
        }
        catch {
            // Fall through to the legacy HTML content field.
        }
    }
    return stripHtml(comment?.content);
}

function normalizeCount(value) {
    const count = Number(value);
    return Number.isFinite(count) && count >= 0 ? count : 0;
}

function normalizeTimestamp(value) {
    const raw = Number(value);
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    return raw < 1_000_000_000_000 ? raw * 1000 : raw;
}

function formatTime(value) {
    const timestamp = normalizeTimestamp(value);
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function serverReplyCount(comment) {
    return normalizeCount(comment?.frequencyData?.totalCommentCnt ?? comment?.frequencyData?.commentCnt);
}

function requireComment(comment, label) {
    if (!comment || typeof comment !== 'object' || Array.isArray(comment)) {
        throw new CommandExecutionError(`Nowcoder ${label} was malformed`);
    }
    const id = normalizeId(comment.id);
    if (!id) {
        throw new CommandExecutionError(`Nowcoder ${label} was missing a valid id`);
    }
    return id;
}

function formatComment(comment, rootId = '') {
    const id = requireComment(comment, rootId ? 'reply' : 'top-level comment');
    const parentId = rootId ? normalizeId(comment.toCommentId) : '';
    return {
        rank: 0,
        id,
        root_id: rootId || id,
        parent_id: parentId,
        depth: rootId ? null : 0,
        ancestry_complete: !rootId,
        author_id: normalizeId(comment.authorId ?? comment.userBrief?.userId),
        author: String(comment.userBrief?.nickname ?? ''),
        reply_to_author_id: rootId ? normalizeId(comment.toUserId) : '',
        reply_to_author: rootId ? String(comment.toUserBrief?.nickname ?? '') : '',
        content: commentText(comment),
        likes: normalizeCount(comment.frequencyData?.likeCnt),
        replies: serverReplyCount(comment),
        direct_replies: null,
        time: formatTime(comment.createTime),
        location: String(comment.ip4Location ?? ''),
    };
}

async function collectCommentRecords({ entityId, entityType, order, startPage, limit, allowEmpty = false }) {
    const records = [];
    const seenIds = new Set();
    let knownTotalPage = null;

    for (let request = 0; request < MAX_COMMENT_PAGE_REQUESTS; request += 1) {
        const pageNo = startPage + request;
        const params = new URLSearchParams({
            entityId,
            entityType: String(entityType),
            order: String(order),
            pageNo: String(pageNo),
            toCommentId: '0',
        });
        const data = await fetchNowcoder(`/api/sparta/comment/list-by-page?${params}`, 'comment list');
        if (!data || typeof data !== 'object' || !Array.isArray(data.records)) {
            throw new CommandExecutionError('Nowcoder comment list returned malformed data');
        }

        for (const comment of data.records) {
            const id = requireComment(comment, `comment list page ${pageNo} row`);
            if (seenIds.has(id)) continue;
            seenIds.add(id);
            records.push(comment);
            if (records.length >= limit) break;
        }

        const reportedTotalPage = Number(data.totalPage);
        if (Number.isInteger(reportedTotalPage) && reportedTotalPage > 0) {
            knownTotalPage = reportedTotalPage;
        }
        const pageSize = Number(data.size) || COMMENT_PAGE_SIZE;
        const emptyPage = data.records.length === 0;
        const shortPageWithoutTotal = knownTotalPage == null
            && data.records.length > 0
            && data.records.length < pageSize;
        if (records.length >= limit
            || emptyPage
            || shortPageWithoutTotal
            || (knownTotalPage != null && pageNo >= knownTotalPage)) {
            break;
        }
    }

    if (records.length === 0 && !allowEmpty) {
        throw new EmptyResultError(COMMAND, `No comments found for entity ${entityId}.`);
    }
    return records.slice(0, limit);
}

function buildThread(rootComment, replyComments) {
    const root = formatComment(rootComment);
    const replies = replyComments.map(comment => formatComment(comment, root.id));
    const byId = new Map([[root.id, root], ...replies.map(row => [row.id, row])]);
    const ancestryCache = new Map([[root.id, { distance: 0, resolved: true }]]);

    const resolveAncestry = (row, visiting = new Set()) => {
        if (ancestryCache.has(row.id)) return ancestryCache.get(row.id);
        if (visiting.has(row.id)) return { distance: null, resolved: false };

        const nextVisiting = new Set(visiting).add(row.id);
        const parent = byId.get(row.parent_id);
        const parentAncestry = parent && parent.id !== row.id
            ? resolveAncestry(parent, nextVisiting)
            : { distance: null, resolved: false };
        const ancestry = parentAncestry.resolved
            ? { distance: parentAncestry.distance + 1, resolved: true }
            : { distance: null, resolved: false };
        ancestryCache.set(row.id, ancestry);
        return ancestry;
    };

    for (const row of replies) {
        const ancestry = resolveAncestry(row);
        row.depth = ancestry.distance;
        row.ancestry_complete = ancestry.resolved;
        const parent = byId.get(row.parent_id);
        if (parent) {
            if (!row.reply_to_author_id) row.reply_to_author_id = parent.author_id;
            if (!row.reply_to_author) row.reply_to_author = parent.author;
        }
    }

    const directReplyCounts = new Map();
    for (const row of replies) {
        if (byId.has(row.parent_id) && row.parent_id !== row.id) {
            directReplyCounts.set(row.parent_id, (directReplyCounts.get(row.parent_id) ?? 0) + 1);
        }
    }
    for (const row of byId.values()) {
        row.direct_replies = directReplyCounts.get(row.id) ?? 0;
    }

    const children = new Map();
    for (const row of replies) {
        if (!byId.has(row.parent_id) || row.parent_id === row.id) continue;
        const siblings = children.get(row.parent_id) ?? [];
        siblings.push(row);
        children.set(row.parent_id, siblings);
    }

    const ordered = [];
    const visited = new Set();
    const appendComponent = (row) => {
        if (visited.has(row.id)) return;
        visited.add(row.id);
        ordered.push(row);
        for (const child of children.get(row.id) ?? []) {
            appendComponent(child);
        }
    };

    appendComponent(root);
    for (const row of replies) {
        if (!byId.has(row.parent_id) || row.parent_id === row.id) appendComponent(row);
    }
    for (const row of replies) {
        appendComponent(row);
    }
    return ordered;
}

async function expandThreads(topLevelComments, { order, repliesLimit }) {
    const threads = [];
    for (let offset = 0; offset < topLevelComments.length; offset += REPLY_CONCURRENCY) {
        const batch = topLevelComments.slice(offset, offset + REPLY_CONCURRENCY);
        const expanded = await Promise.all(batch.map(async (comment) => {
            const rootId = requireComment(comment, 'top-level comment');
            if (serverReplyCount(comment) === 0) return buildThread(comment, []);
            const replies = await collectCommentRecords({
                entityId: rootId,
                entityType: 2,
                order,
                startPage: 1,
                limit: repliesLimit,
                allowEmpty: true,
            });
            return buildThread(comment, replies);
        }));
        threads.push(...expanded);
    }
    return threads.flat();
}

function parseDateBound(raw, name, endOfDay = false) {
    if (raw == null || String(raw).trim() === '') return null;
    const value = String(raw).trim();
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`
        : value;
    const timestamp = Date.parse(normalized);
    if (!Number.isFinite(timestamp)) {
        throw new ArgumentError(`${COMMAND} ${name} must be an ISO date or timestamp`);
    }
    return timestamp;
}

function parseOptionalAuthorId(raw) {
    if (raw == null || String(raw).trim() === '') return '';
    const authorId = String(raw).trim();
    if (!/^[1-9]\d*$/.test(authorId)) {
        throw new ArgumentError(`${COMMAND} author-id must be a positive numeric user id`);
    }
    return authorId;
}

function buildFilters(kwargs) {
    const since = parseDateBound(kwargs.since, 'since');
    const until = parseDateBound(kwargs.until, 'until', true);
    if (since != null && until != null && since > until) {
        throw new ArgumentError(`${COMMAND} since must not be later than until`);
    }
    return {
        minLikes: requireInteger(kwargs['min-likes'], 'min-likes', { fallback: 0 }),
        minReplies: requireInteger(kwargs['min-replies'], 'min-replies', { fallback: 0 }),
        minDirectReplies: requireInteger(kwargs['min-direct-replies'], 'min-direct-replies', { fallback: 0 }),
        authorId: parseOptionalAuthorId(kwargs['author-id']),
        authorQuery: String(kwargs.author ?? '').trim().toLowerCase(),
        contains: String(kwargs.contains ?? '').trim().toLowerCase(),
        since,
        until,
        sort: parseSort(kwargs.sort),
    };
}

function filterAndSortRows(rows, filters) {
    const rowTimestamp = (row) => {
        const timestamp = row.time ? Date.parse(row.time) : 0;
        return Number.isFinite(timestamp) ? timestamp : 0;
    };
    const filtered = rows.filter((row) => {
        if (row.likes < filters.minLikes
            || row.replies < filters.minReplies
            || (row.direct_replies ?? 0) < filters.minDirectReplies) return false;
        if (filters.authorId && row.author_id !== filters.authorId) return false;
        if (filters.authorQuery && !row.author.toLowerCase().includes(filters.authorQuery)) return false;
        if (filters.contains && !row.content.toLowerCase().includes(filters.contains)) return false;
        const timestamp = rowTimestamp(row);
        if (filters.since != null && timestamp < filters.since) return false;
        if (filters.until != null && timestamp > filters.until) return false;
        return true;
    });

    if (filters.sort !== 'thread') {
        const key = filters.sort;
        filtered.sort((left, right) => {
            if (key === 'time') return rowTimestamp(right) - rowTimestamp(left);
            const leftValue = key === 'direct-replies' ? left.direct_replies ?? -1 : left[key];
            const rightValue = key === 'direct-replies' ? right.direct_replies ?? -1 : right[key];
            return rightValue - leftValue || rowTimestamp(right) - rowTimestamp(left);
        });
    }
    return filtered.map((row, index) => ({ ...row, rank: index + 1 }));
}

cli({
    site: 'nowcoder',
    name: 'comments',
    access: 'read',
    description: 'Get and mine post comments, authors, and reply relationships',
    domain: 'www.nowcoder.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'Post numeric ID, moment UUID, or Nowcoder URL' },
        { name: 'with-replies', type: 'boolean', default: false, help: 'Expand replies under each top-level comment' },
        { name: 'page', type: 'int', default: 1, valueRequired: true, help: 'Starting page for top-level comments' },
        { name: 'limit', type: 'int', default: 20, valueRequired: true, help: 'Top-level comments to scan (max 100)' },
        { name: 'replies-limit', type: 'int', default: 20, valueRequired: true, help: 'Replies to fetch per top-level comment (max 100)' },
        { name: 'order', type: 'string', default: 'default', valueRequired: true, choices: ['default', 'new', 'hot'], help: 'Nowcoder server-side comment order' },
        { name: 'min-likes', type: 'int', default: 0, valueRequired: true, help: 'Only keep comments with at least this many likes' },
        { name: 'min-replies', type: 'int', default: 0, valueRequired: true, help: 'Only keep comments with at least this many server-reported replies' },
        { name: 'min-direct-replies', type: 'int', default: 0, valueRequired: true, help: 'Only keep comments with at least this many direct replies in the fetched result; requires --with-replies' },
        { name: 'author-id', type: 'string', valueRequired: true, help: 'Only keep comments from this numeric user ID' },
        { name: 'author', type: 'string', valueRequired: true, help: 'Only keep comments whose author name contains this text' },
        { name: 'contains', type: 'string', valueRequired: true, help: 'Only keep comments containing this text' },
        { name: 'since', type: 'string', valueRequired: true, help: 'Only keep comments at or after this ISO date/time' },
        { name: 'until', type: 'string', valueRequired: true, help: 'Only keep comments at or before this ISO date/time' },
        { name: 'sort', type: 'string', default: 'thread', valueRequired: true, choices: ['thread', 'likes', 'replies', 'direct-replies', 'time'], help: 'Sort output; thread preserves reply-tree order' },
    ],
    columns: [
        'rank', 'id', 'root_id', 'parent_id', 'depth', 'ancestry_complete',
        'author_id', 'author', 'reply_to_author_id', 'reply_to_author',
        'content', 'likes', 'replies', 'direct_replies', 'time', 'location',
    ],
    func: async (kwargs) => {
        const target = parseTarget(kwargs.id);
        const withReplies = Boolean(kwargs['with-replies']);

        const startPage = requireInteger(kwargs.page, 'page', { fallback: 1, min: 1, max: 10000 });
        const limit = requireInteger(kwargs.limit, 'limit', { fallback: 20, min: 1, max: MAX_TOP_LEVEL_LIMIT });
        const repliesLimit = requireInteger(kwargs['replies-limit'], 'replies-limit', { fallback: 20, min: 1, max: MAX_REPLIES_LIMIT });
        const order = parseOrder(kwargs.order);
        const filters = buildFilters(kwargs);
        if (!withReplies && (filters.minDirectReplies > 0 || filters.sort === 'direct-replies')) {
            throw new ArgumentError(`${COMMAND} direct-reply filtering and sorting require --with-replies`);
        }

        const entity = await resolveCommentEntity(target);
        const topLevelComments = await collectCommentRecords({
            ...entity,
            order,
            startPage,
            limit,
        });
        const rows = withReplies
            ? await expandThreads(topLevelComments, { order, repliesLimit })
            : topLevelComments.map(comment => formatComment(comment));

        const result = filterAndSortRows(rows, filters);
        if (result.length === 0) {
            throw new EmptyResultError(COMMAND, 'No comments matched the requested filters.');
        }
        return result;
    },
});

export const __test__ = {
    parseOrder,
    parseSort,
    parseTarget,
    resolveCommentEntity,
    commentText,
    buildThread,
    buildFilters,
    filterAndSortRows,
};
