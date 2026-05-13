import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CliError } from '@jackwener/opencli/errors';

// Light-weight HTML → text, preserving paragraph / heading / list-item
// line breaks. Zhihu answer `content` is HTML, so we map block-level
// closing tags + `<br>` to newlines before stripping the rest.
function stripHtml(html) {
    if (!html) return '';
    return html
        .replace(/<br\s*\/?\s*>/gi, '\n')
        // Block-level closing tags become paragraph breaks (double
        // newline) so the stripped text stays readable. The trailing
        // `\n{3,}` collapse pass below normalizes accidental triples.
        .replace(/<\/(?:p|div|h[1-6]|li|blockquote)>/gi, '\n\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

const ANSWER_ID_RE = /^\d+$/;
const ANSWER_URL_RE = /^https?:\/\/(?:www\.)?zhihu\.com\/(?:question\/\d+\/)?answer\/(\d+)\/?(?:[?#].*)?$/i;
const ANSWER_TYPED_RE = /^answer:\d+:(\d+)$/;

// Accepts: bare numeric id (`1937205528846655537`), the typed
// target form used by the existing zhihu write adapters
// (`answer:<qid>:<aid>`), or the full Zhihu URL pasted from a
// browser (`https://www.zhihu.com/question/<qid>/answer/<aid>`).
// Returns the numeric answer id, or null when the input does not
// resolve to any of those shapes.
function extractAnswerId(input) {
    const value = String(input ?? '').trim();
    if (!value) return null;
    if (ANSWER_ID_RE.test(value)) return value;
    let m = value.match(ANSWER_TYPED_RE);
    if (m) return m[1];
    m = value.match(ANSWER_URL_RE);
    if (m) return m[1];
    return null;
}

cli({
    site: 'zhihu',
    name: 'answer-detail',
    access: 'read',
    description: '知乎单个回答完整内容（按 answer ID 获取）',
    domain: 'www.zhihu.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'id', required: true, positional: true, help: 'Answer ID, full Zhihu answer URL, or typed target (answer:<qid>:<aid>)' },
        { name: 'max-content', type: 'int', default: 0, help: 'Optional cap on stripped content length in characters (0 = no truncation, return the full answer)' },
    ],
    columns: ['id', 'author', 'votes', 'comments', 'question_id', 'question_title', 'url', 'created_at', 'updated_at', 'content'],
    func: async (page, kwargs) => {
        const answerId = extractAnswerId(kwargs.id);
        if (!answerId) {
            throw new CliError(
                'INVALID_INPUT',
                'Answer ID must be a numeric id, a Zhihu answer URL, or answer:<qid>:<aid>',
                'Example: opencli zhihu answer-detail 1937205528846655537',
            );
        }
        // `--max-content 0` (the default) means "no cap, return the
        // full stripped answer". Any positive value is an opt-in user
        // cap, mirroring the wikipedia `page` pattern — we never
        // silently truncate behind the user's back.
        const rawMaxContent = kwargs['max-content'];
        const maxContent = rawMaxContent == null ? 0 : Number(rawMaxContent);
        if (!Number.isInteger(maxContent) || maxContent < 0) {
            throw new CliError(
                'INVALID_INPUT',
                '--max-content must be a non-negative integer (0 = no cap, full content)',
                'Example: --max-content 2000',
            );
        }
        // Navigate to the answer page itself: this both seeds the
        // cookie/anti-bot context and works even when the caller did
        // not supply the parent question id (Zhihu redirects from
        // `/answer/<aid>` to the canonical `/question/<qid>/answer/<aid>`).
        await page.goto(`https://www.zhihu.com/answer/${answerId}`);
        const apiUrl = `https://www.zhihu.com/api/v4/answers/${answerId}?include=content,voteup_count,comment_count,author,created_time,updated_time,question`;
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
                throw new AuthRequiredError('www.zhihu.com', 'Failed to fetch Zhihu answer detail');
            }
            throw new CliError(
                'FETCH_ERROR',
                status
                    ? `Zhihu answer detail request failed (HTTP ${status})`
                    : 'Zhihu answer detail request failed',
                'Try again later or rerun with -v for more detail',
            );
        }
        const question = data.question || {};
        // `question.id` from Zhihu is small enough to round-trip
        // through `Number`, but answer ids (and increasingly question
        // ids since 2024) can exceed `Number.MAX_SAFE_INTEGER`. Always
        // anchor the row identity to the parsed input string — which
        // we already validated as numeric — instead of stringifying a
        // possibly-truncated `data.id`.
        const questionId = question.id == null ? '' : String(question.id);
        const stripped = stripHtml(data.content || '');
        // Truncation is opt-in only; default `maxContent === 0` short-
        // circuits the conditional so the full stripped body is returned.
        const content = maxContent > 0 && stripped.length > maxContent
            ? stripped.substring(0, maxContent)
            : stripped;
        return [{
            id: answerId,
            author: data.author?.name || 'anonymous',
            votes: Number.isInteger(data.voteup_count) ? data.voteup_count : 0,
            comments: Number.isInteger(data.comment_count) ? data.comment_count : 0,
            question_id: questionId,
            question_title: question.title || '',
            url: questionId
                ? `https://www.zhihu.com/question/${questionId}/answer/${answerId}`
                : `https://www.zhihu.com/answer/${answerId}`,
            created_at: typeof data.created_time === 'number' && data.created_time > 0
                ? new Date(data.created_time * 1000).toISOString()
                : '',
            updated_at: typeof data.updated_time === 'number' && data.updated_time > 0
                ? new Date(data.updated_time * 1000).toISOString()
                : '',
            content,
        }];
    },
});

export const __test__ = { stripHtml, extractAnswerId };
