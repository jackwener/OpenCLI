import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { stripHtml } from './text.js';

function answerIdFromUrl(url) {
    if (typeof url !== 'string') return '';
    try {
        const parsed = new URL(url);
        if (parsed.hostname !== 'www.zhihu.com' && parsed.hostname !== 'zhihu.com') return '';
        return parsed.pathname.match(/^\/question\/\d+\/answer\/(\d+)\/?$/)?.[1]
            || parsed.pathname.match(/^\/api\/v4\/answers\/(\d+)\/?$/)?.[1]
            || parsed.pathname.match(/^\/answer\/(\d+)\/?$/)?.[1]
            || '';
    } catch {
        return '';
    }
}

function answerId(item) {
    const fromUrl = answerIdFromUrl(item.url);
    if (fromUrl) return fromUrl;
    if (typeof item.id === 'string' && /^\d+$/.test(item.id)) return item.id;
    if (typeof item.id === 'number' && Number.isSafeInteger(item.id) && item.id > 0) return String(item.id);
    return '';
}

function answerDedupeKey(item) {
    const id = answerId(item);
    if (id) return `id:${id}`;
    return `fallback:${item.author?.name || 'anonymous'}:${item.question?.title || item.content || ''}`;
}

function formatDate(ts) {
    if (!ts || ts <= 0) return '';
    try {
        return new Date(ts * 1000).toISOString();
    } catch {
        return '';
    }
}

const MAX_LIMIT = 1000;
const PAGE_SIZE = 20;

cli({
    site: 'zhihu',
    name: 'user-answers',
    access: 'read',
    description: '知乎用户回答列表（按用户 url_token 获取）',
    domain: 'www.zhihu.com',
    browser: true,
    strategy: Strategy.COOKIE,
    args: [
        { name: 'user', required: true, positional: true, help: 'User url_token (e.g. xu-ze-qiu) or full user page URL' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of answers (max 1000)' },
        { name: 'sort', default: 'created', choices: ['created', 'default'], help: 'Sort order: created (newest first) or default' },
        { name: 'offset', type: 'int', default: 0, help: 'Starting offset for pagination' },
    ],
    columns: ['rank', 'id', 'author', 'questionId', 'questionTitle', 'votes', 'createdAt', 'url', 'excerpt'],
    func: async (page, kwargs) => {
        const { user: userArg, limit = 20, sort = 'created', offset = 0 } = kwargs;

        // Parse user token from argument (accept url_token or full URL)
        let userToken = String(userArg || '').trim();
        if (!userToken) {
            throw new ArgumentError('zhihu user-answers requires a user url_token or URL', 'Example: opencli zhihu user-answers xu-ze-qiu');
        }
        // Extract token from full URL if given
        const peopleMatch = userToken.match(/zhihu\.com\/people\/([^/?]+)/);
        if (peopleMatch) {
            userToken = peopleMatch[1];
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(userToken)) {
            throw new ArgumentError('zhihu user-answers: invalid user token format', 'Use a valid url_token like xu-ze-qiu or mr-dang-77');
        }

        const answerLimit = Number(limit);
        if (!Number.isInteger(answerLimit) || answerLimit <= 0 || answerLimit > MAX_LIMIT) {
            throw new ArgumentError(`zhihu user-answers --limit must be a positive integer no greater than ${MAX_LIMIT}`, 'Use a normal-sized limit to avoid slow requests or Zhihu risk controls');
        }

        const startOffset = Number(offset);
        if (!Number.isInteger(startOffset) || startOffset < 0) {
            throw new ArgumentError('zhihu user-answers --offset must be a non-negative integer', 'Example: opencli zhihu user-answers xu-ze-qiu --offset 20');
        }

        const sortBy = String(sort);
        if (sortBy !== 'created' && sortBy !== 'default') {
            throw new ArgumentError('zhihu user-answers --sort must be one of: created, default', 'Example: opencli zhihu user-answers xu-ze-qiu --sort created');
        }

        // Navigate to user page first to establish session context
        await page.goto(`https://www.zhihu.com/people/${userToken}/answers`);

        // Build API URL
        const include = encodeURIComponent('data[*].content,url,voteup_count,comment_count,author,question,created_time');
        let apiUrl = `https://www.zhihu.com/api/v4/members/${userToken}/answers`
            + `?limit=${PAGE_SIZE}&offset=${startOffset}&sort_by=${sortBy}&include=${include}`;

        const answers = [];
        const seen = new Set();
        const visited = new Set();

        while (apiUrl && answers.length < answerLimit && !visited.has(apiUrl)) {
            visited.add(apiUrl);
            const data = await page.evaluate(`
        (async () => {
          const r = await fetch(${JSON.stringify(apiUrl)}, { credentials: 'include' });
          if (!r.ok) return { __httpError: r.status };
          return await r.json();
        })()
      `);

            if (!data || data.__httpError) {
                const status = data?.__httpError;
                if (status === 401 || status === 403) {
                    throw new AuthRequiredError('www.zhihu.com', 'Failed to fetch user answers from Zhihu. Please log in at zhihu.com first.');
                }
                throw new CommandExecutionError(
                    status ? `Zhihu user-answers request failed (HTTP ${status})` : 'Zhihu user-answers request failed',
                    'Try again later or rerun with -v for more detail'
                );
            }

            if (!Array.isArray(data.data)) {
                throw new CommandExecutionError('Zhihu user-answers returned malformed data list');
            }

            for (const item of data.data) {
                const key = answerDedupeKey(item);
                if (seen.has(key)) continue;
                seen.add(key);
                answers.push(item);
                if (answers.length >= answerLimit) break;
            }

            if (answers.length >= answerLimit) break;
            if (data.paging?.is_end) break;

            const next = data.paging?.next;
            if (!next || typeof next !== 'string') break;
            // Normalize http → https
            apiUrl = next.startsWith('http://') ? next.replace('http://', 'https://') : next;
        }

        if (answers.length === 0) {
            throw new EmptyResultError('zhihu user-answers', `No answers found for user "${userToken}". The user may not exist or their answers are not publicly accessible.`);
        }

        return answers.map((item, i) => {
            const id = answerId(item);
            const question = item.question || {};
            const questionId = question.id ? String(question.id) : '';
            return {
                rank: startOffset + i + 1,
                id,
                author: item.author?.name || 'anonymous',
                questionId,
                questionTitle: question.title || '',
                votes: item.voteup_count || 0,
                createdAt: formatDate(item.created_time),
                url: id && questionId ? `https://www.zhihu.com/question/${questionId}/answer/${id}` : '',
                excerpt: stripHtml(item.content || '').substring(0, 200),
            };
        });
    },
});
