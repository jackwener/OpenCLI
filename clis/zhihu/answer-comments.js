import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { ANSWER_PATH_RE, parseAnswerTarget } from './answer-target.js';
import { buildCommentRows, fetchRepliesByRoot, fetchRootComments } from './answer-comments-helpers.js';

function extractQuestionIdFromAnswerUrl(input) {
    const value = String(input ?? '').trim();
    if (!value) return '';
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || (url.hostname !== 'www.zhihu.com' && url.hostname !== 'zhihu.com')) return '';
        return url.pathname.match(ANSWER_PATH_RE)?.[1] || '';
    } catch {
        return '';
    }
}

const MAX_LIMIT = 1000;
const MAX_REPLIES_LIMIT = 100;

cli({
    site: 'zhihu',
    name: 'answer-comments',
    access: 'read',
    description: '知乎回答评论列表（保留回复层级）',
    domain: 'www.zhihu.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'id', required: true, positional: true, help: 'Answer ID, full Zhihu answer URL, or typed target (answer:<qid>:<aid>)' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of top-level comments (max 1000)' },
        { name: 'replies-limit', type: 'int', default: 3, help: 'Number of replies to include per top-level comment (max 100)' },
        { name: 'order', default: 'score', choices: ['score', 'latest'], help: 'Root comment order' },
    ],
    columns: ['rank', 'comment_rank', 'reply_rank', 'depth', 'id', 'parent_id', 'author', 'reply_to', 'likes', 'created_at', 'url', 'content'],
    func: async (page, kwargs) => {
        const target = parseAnswerTarget(kwargs.id);
        if (!target) {
            throw new ArgumentError(
                'Answer ID must be a numeric id, a Zhihu answer URL, or answer:<qid>:<aid>',
                'Example: opencli zhihu answer-comments 1937205528846655537',
            );
        }
        const topLevelLimit = Number(kwargs.limit ?? 20);
        if (!Number.isInteger(topLevelLimit) || topLevelLimit <= 0 || topLevelLimit > MAX_LIMIT) {
            throw new ArgumentError(`--limit must be a positive integer no greater than ${MAX_LIMIT}`);
        }
        const repliesLimit = Number(kwargs['replies-limit'] ?? 3);
        if (!Number.isInteger(repliesLimit) || repliesLimit < 0 || repliesLimit > MAX_REPLIES_LIMIT) {
            throw new ArgumentError(`--replies-limit must be an integer between 0 and ${MAX_REPLIES_LIMIT}`);
        }
        const order = String(kwargs.order ?? 'score');
        if (order !== 'score' && order !== 'latest') {
            throw new ArgumentError('--order must be score or latest');
        }

        const { answerId } = target;
        try {
            await page.goto(`https://www.zhihu.com/answer/${answerId}`);
        } catch (err) {
            throw new CommandExecutionError(
                `Failed to open Zhihu answer ${answerId}: ${err instanceof Error ? err.message : String(err)}`,
                'Open the answer URL in Chrome and retry after the page is reachable.',
            );
        }
        const currentQuestionId = page.getCurrentUrl
            ? extractQuestionIdFromAnswerUrl(await page.getCurrentUrl().catch(() => ''))
            : '';
        const questionId = target.questionId || currentQuestionId;

        const roots = await fetchRootComments(page, answerId, order, topLevelLimit);
        if (roots.length === 0) {
            throw new EmptyResultError('zhihu answer-comments', `No comments found for answer ${answerId}.`);
        }
        const repliesByRoot = await fetchRepliesByRoot(page, roots, repliesLimit);
        return buildCommentRows(roots, repliesByRoot, { answerId, questionId });
    },
});
