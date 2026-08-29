import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { normalizeJikeLimit, postJikeApi, requireJikeIdentity } from './utils.js';

const API_PATH = '/1.0/search/integrate';
const PAGE_SIZE = 20;
const DEFAULT_LIMIT = 20;
const MAX_PAGES = 50;

async function fetchSearchPage(page, keyword, loadMoreKey) {
    const requestBody = {
        keywords: keyword,
        limit: PAGE_SIZE,
        ...(loadMoreKey ? { loadMoreKey } : {}),
    };
    const body = await postJikeApi(page, API_PATH, requestBody, 'Jike search API');
    if (!body || typeof body !== 'object' || body.success !== true || !Array.isArray(body.data)) {
        throw new CommandExecutionError(`Jike search API failed: ${String(body?.message || 'malformed response')}`);
    }
    return body;
}

function mapPost(post) {
    if (!post || typeof post !== 'object' || typeof post.id !== 'string' || !post.id) {
        throw new CommandExecutionError('Jike search API returned a malformed post');
    }
    const content = typeof post.content === 'string' ? post.content : '';
    return {
        id: post.id,
        author: typeof post.user?.screenName === 'string' ? post.user.screenName : '',
        content: content.replace(/\n/g, ' ').slice(0, 120),
        likes: Number.isFinite(Number(post.likeCount)) ? Number(post.likeCount) : 0,
        comments: Number.isFinite(Number(post.commentCount)) ? Number(post.commentCount) : 0,
        time: typeof post.actionTime === 'string' ? post.actionTime : (typeof post.createdAt === 'string' ? post.createdAt : ''),
        url: `https://web.okjike.com/originalPost/${post.id}`,
    };
}

async function searchPosts(page, keyword, limit) {
    const rows = [];
    const seenIds = new Set();
    const seenCursors = new Set();
    let loadMoreKey = null;
    for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
        const body = await fetchSearchPage(page, keyword, loadMoreKey);
        for (const item of body.data) {
            if (item?.type !== 'ORIGINAL_POST') continue;
            const row = mapPost(item);
            if (seenIds.has(row.id)) continue;
            seenIds.add(row.id);
            rows.push(row);
            if (rows.length >= limit) return rows;
        }
        const next = body.loadMoreKey;
        if (next == null) {
            if (rows.length === 0) throw new EmptyResultError('jike search', `No posts found for "${keyword}"`);
            return rows;
        }
        if (typeof next !== 'object' || Array.isArray(next)) {
            throw new CommandExecutionError('Jike search API returned a malformed pagination cursor');
        }
        const cursorKey = JSON.stringify(next);
        if (seenCursors.has(cursorKey)) {
            throw new CommandExecutionError('Jike search pagination returned a repeated cursor');
        }
        seenCursors.add(cursorKey);
        loadMoreKey = next;
    }
    throw new CommandExecutionError(`Jike search pagination exceeded ${MAX_PAGES} pages before satisfying --limit`);
}

cli({
    site: 'jike',
    name: 'search',
    access: 'read',
    description: '搜索即刻帖子',
    domain: 'web.okjike.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'query', type: 'string', required: true, positional: true, help: '即刻搜索关键词' },
        { name: 'limit', type: 'int', default: DEFAULT_LIMIT },
    ],
    columns: ['id', 'author', 'content', 'likes', 'comments', 'time', 'url'],
    func: async (page, kwargs) => {
        const keyword = String(kwargs.query || '').trim();
        if (!keyword) throw new ArgumentError('Jike search query cannot be empty');
        const limit = normalizeJikeLimit(kwargs.limit, DEFAULT_LIMIT);
        await page.goto(`https://web.okjike.com/search?q=${encodeURIComponent(keyword)}`);
        await requireJikeIdentity(page);
        return searchPosts(page, keyword, limit);
    },
});
