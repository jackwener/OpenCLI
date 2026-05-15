/**
 * Douyin get-comments — fetch video comments via the existing signed browser API helper.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { fetchDouyinComments } from './_shared/public-api.js';

function parseAwemeId(input) {
    const raw = String(input || '').trim();
    const match = raw.match(/\/video\/(\d+)/);
    if (match)
        return match[1];
    if (/^\d+$/.test(raw))
        return raw;
    throw new CommandExecutionError(`Cannot parse aweme_id from: ${raw}. Expected a Douyin video URL or numeric ID.`);
}

function readLimit(raw) {
    const limit = Number(raw ?? 20);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        throw new ArgumentError('Argument "limit" must be an integer in [1, 50].');
    }
    return limit;
}

cli({
    site: 'douyin',
    name: 'get-comments',
    access: 'read',
    description: '获取抖音视频评论',
    domain: 'www.douyin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'url', required: true, positional: true, help: 'Douyin video URL or aweme_id' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of comments (max 50)' },
    ],
    columns: ['rank', 'comment_id', 'author', 'text', 'likes', 'replies_count', 'time'],
    func: async (page, kwargs) => {
        const awemeId = parseAwemeId(kwargs.url);
        const limit = readLimit(kwargs.limit);

        await page.goto('https://www.douyin.com');
        await page.wait(3);

        const comments = await fetchDouyinComments(page, awemeId, limit);
        if (comments.length === 0)
            throw new EmptyResultError('douyin/get-comments', 'No comments found');

        return comments.map((comment, i) => ({
            rank: i + 1,
            comment_id: comment.cid || `dy-comment-${i + 1}`,
            author: comment.nickname,
            text: String(comment.text || '').substring(0, 300),
            likes: comment.digg_count,
            replies_count: comment.reply_comment_total ?? 0,
            time: comment.create_time ? new Date(comment.create_time * 1000).toISOString().slice(0, 19).replace('T', ' ') : '',
        }));
    },
});
