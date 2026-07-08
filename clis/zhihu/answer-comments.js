import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { stripHtml as stripHtmlText } from './text.js';

function stripHtml(html) {
    return stripHtmlText(html, { preserveBlocks: true });
}

const ANSWER_ID_RE = /^\d+$/;
const ANSWER_TYPED_RE = /^answer:(\d+):(\d+)$/;
const ANSWER_PATH_RE = /^\/question\/(\d+)\/answer\/(\d+)\/?$/;
const BARE_ANSWER_PATH_RE = /^\/answer\/(\d+)\/?$/;

function parseAnswerTarget(input) {
    const value = String(input ?? '').trim();
    if (!value) return null;
    if (ANSWER_ID_RE.test(value)) return { answerId: value, questionId: '' };
    const typed = value.match(ANSWER_TYPED_RE);
    if (typed) return { questionId: typed[1], answerId: typed[2] };
    try {
        const url = new URL(value);
        if (
            url.protocol !== 'https:' ||
            url.username ||
            url.password ||
            url.port ||
            (url.hostname !== 'www.zhihu.com' && url.hostname !== 'zhihu.com')
        ) {
            return null;
        }
        let m = url.pathname.match(ANSWER_PATH_RE);
        if (m) return { questionId: m[1], answerId: m[2] };
        m = url.pathname.match(BARE_ANSWER_PATH_RE);
        if (m) return { answerId: m[1], questionId: '' };
    } catch {
        return null;
    }
    return null;
}

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

function normalizeCount(value) {
    return Number.isInteger(value) && value >= 0 ? value : 0;
}

function normalizeUnixSeconds(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? new Date(value * 1000).toISOString()
        : '';
}

function memberName(author) {
    return author?.member?.name || author?.name || '';
}

function normalizeCommentId(value) {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
    return '';
}

function normalizeCommentUrl(url, questionId, answerId, commentId) {
    if (questionId && answerId && commentId) {
        return `https://www.zhihu.com/question/${questionId}/answer/${answerId}#comment-${commentId}`;
    }
    return typeof url === 'string' ? url : '';
}

function normalizeCommentsApiUrl(url, answerId) {
    if (typeof url !== 'string' || !url) return '';
    try {
        const parsed = new URL(url);
        const expectedWwwPath = `/api/v4/answers/${answerId}/comments`;
        const expectedApiPath = `/answers/${answerId}/comments`;
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return '';
        if (parsed.hostname === 'www.zhihu.com' && parsed.pathname === expectedWwwPath) return parsed.toString();
        if (parsed.hostname === 'api.zhihu.com' && parsed.pathname === expectedApiPath) {
            return `https://www.zhihu.com${expectedWwwPath}${parsed.search}`;
        }
    } catch {
        return '';
    }
    return '';
}

function buildRows(comments, { answerId, questionId, topLevelLimit, repliesLimit }) {
    const rows = [];
    let topLevelCount = 0;
    let currentCommentRank = 0;
    let currentReplyCount = 0;
    let reachedTopLevelLimit = false;
    let malformedComments = 0;

    for (const comment of comments) {
        if (!comment || typeof comment !== 'object' || Array.isArray(comment)) {
            malformedComments += 1;
            continue;
        }
        const id = normalizeCommentId(comment.id);
        if (!id) {
            malformedComments += 1;
            continue;
        }
        const author = memberName(comment.author);
        const replyToAuthor = memberName(comment.reply_to_author);
        const isReply = Boolean(replyToAuthor);

        if (!isReply) {
            if (topLevelCount >= topLevelLimit) {
                reachedTopLevelLimit = true;
                break;
            }
            topLevelCount += 1;
            currentCommentRank = topLevelCount;
            currentReplyCount = 0;
        } else if (!currentCommentRank || currentReplyCount >= repliesLimit) {
            continue;
        } else {
            currentReplyCount += 1;
        }

        rows.push({
            rank: rows.length + 1,
            comment_rank: currentCommentRank,
            reply_rank: isReply ? currentReplyCount : 0,
            depth: 0,
            id,
            parent_id: '',
            author: author || 'anonymous',
            reply_to: replyToAuthor,
            likes: normalizeCount(comment.vote_count),
            created_at: normalizeUnixSeconds(comment.created_time),
            url: normalizeCommentUrl(comment.url, questionId, answerId, id),
            content: stripHtml(comment.content || ''),
        });
    }
    return { rows, topLevelCount, reachedTopLevelLimit, malformedComments };
}

const MAX_LIMIT = 1000;
const MAX_REPLIES_LIMIT = 100;
const ZHIHU_PAGE_SIZE = 20;

cli({
    site: 'zhihu',
    name: 'answer-comments',
    access: 'read',
    description: '知乎回答评论列表',
    domain: 'www.zhihu.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'id', required: true, positional: true, help: 'Answer ID, full Zhihu answer URL, or typed target (answer:<qid>:<aid>)' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of top-level comments (max 1000)' },
        { name: 'replies-limit', type: 'int', default: 3, help: 'Number of replies to include per top-level comment (max 100)' },
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

        let url = `https://www.zhihu.com/api/v4/answers/${answerId}/comments?order=normal&limit=${ZHIHU_PAGE_SIZE}&offset=0&status=open`;
        const fetched = [];
        const visited = new Set();

        while (url && !visited.has(url)) {
            visited.add(url);
            const data = await page.evaluate(`
      (async () => {
        const r = await fetch(${JSON.stringify(url)}, { credentials: 'include' });
        if (!r.ok) return { __httpError: r.status };
        try {
          return await r.json();
        } catch (error) {
          return { __malformedJson: error instanceof Error ? error.message : String(error) };
        }
      })()
    `).catch((err) => {
                throw new CommandExecutionError(
                    `Zhihu answer comments request failed: ${err instanceof Error ? err.message : String(err)}`,
                    'Try again later or rerun with -v for more detail.',
                );
            });
            if (!data || data.__httpError) {
                const status = data?.__httpError;
                if (status === 401 || status === 403) {
                    throw new AuthRequiredError('www.zhihu.com', 'Failed to fetch Zhihu answer comments');
                }
                if (status === 404) {
                    throw new EmptyResultError('zhihu answer-comments', `No Zhihu answer comments resource was found for ${answerId}.`);
                }
                throw new CommandExecutionError(
                    status
                        ? `Zhihu answer comments request failed (HTTP ${status})`
                        : 'Zhihu answer comments request failed',
                    'Try again later or rerun with -v for more detail',
                );
            }
            if (data.__malformedJson) {
                throw new CommandExecutionError(
                    `Zhihu answer comments returned malformed JSON: ${data.__malformedJson}`,
                    'Try again later or rerun with -v for more detail',
                );
            }
            if (!Array.isArray(data.data) || !data.paging || typeof data.paging !== 'object') {
                throw new CommandExecutionError(
                    'Zhihu answer comments returned a malformed payload',
                    'Try again later or rerun with -v for more detail',
                );
            }
            fetched.push(...data.data);
            const built = buildRows(fetched, { answerId, questionId, topLevelLimit, repliesLimit });
            if (built.malformedComments > 0) {
                throw new CommandExecutionError('Zhihu answer comments contained rows without comment ids');
            }
            if (built.reachedTopLevelLimit || data.paging?.is_end) {
                if (built.rows.length === 0) {
                    throw new EmptyResultError('zhihu answer-comments', `No comments found for answer ${answerId}.`);
                }
                return built.rows;
            }
            const next = normalizeCommentsApiUrl(data.paging?.next, answerId);
            if (!next) {
                throw new CommandExecutionError('Zhihu answer comments pagination returned malformed next URL');
            }
            if (visited.has(next)) {
                throw new CommandExecutionError('Zhihu answer comments pagination returned a repeated next URL');
            }
            url = next;
        }

        const built = buildRows(fetched, { answerId, questionId, topLevelLimit, repliesLimit });
        if (built.malformedComments > 0) {
            throw new CommandExecutionError('Zhihu answer comments contained rows without comment ids');
        }
        if (built.rows.length === 0) {
            throw new EmptyResultError('zhihu answer-comments', `No comments found for answer ${answerId}.`);
        }
        return built.rows;
    },
});

export const __test__ = { stripHtml, parseAnswerTarget, normalizeCommentsApiUrl, buildRows };
