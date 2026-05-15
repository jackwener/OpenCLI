import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

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
const ANSWER_TYPED_RE = /^answer:(\d+):(\d+)$/;
const ANSWER_PATH_RE = /^\/question\/(\d+)\/answer\/(\d+)\/?$/;
const BARE_ANSWER_PATH_RE = /^\/answer\/(\d+)\/?$/;
const QUESTION_PATH_RE = /^\/question\/(\d+)\/?$/;
const QUESTION_API_PATH_RE = /^\/api\/v4\/questions\/(\d+)\/?$/;

// Accepts: bare numeric id (`1937205528846655537`), the typed
// target form used by the existing zhihu write adapters
// (`answer:<qid>:<aid>`), or the full Zhihu URL pasted from a
// browser (`https://www.zhihu.com/question/<qid>/answer/<aid>`).
// Returns string-safe ids, or null when the input does not resolve to
// any of those exact shapes.
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

function extractAnswerId(input) {
    return parseAnswerTarget(input)?.answerId ?? null;
}

function extractQuestionIdFromAnswerUrl(input) {
    const value = String(input ?? '').trim();
    if (!value) return '';
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || (url.hostname !== 'www.zhihu.com' && url.hostname !== 'zhihu.com')) {
            return '';
        }
        return url.pathname.match(ANSWER_PATH_RE)?.[1]
            || url.pathname.match(QUESTION_PATH_RE)?.[1]
            || url.pathname.match(QUESTION_API_PATH_RE)?.[1]
            || '';
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
        const target = parseAnswerTarget(kwargs.id);
        if (!target) {
            throw new ArgumentError(
                'Answer ID must be a numeric id, a Zhihu answer URL, or answer:<qid>:<aid>',
                'Example: opencli zhihu answer-detail 1937205528846655537',
            );
        }
        const { answerId } = target;
        // `--max-content 0` (the default) means "no cap, return the
        // full stripped answer". Any positive value is an opt-in user
        // cap, mirroring the wikipedia `page` pattern — we never
        // silently truncate behind the user's back.
        const rawMaxContent = kwargs['max-content'];
        const maxContent = rawMaxContent == null ? 0 : Number(rawMaxContent);
        if (!Number.isInteger(maxContent) || maxContent < 0) {
            throw new ArgumentError(
                '--max-content must be a non-negative integer (0 = no cap, full content)',
                'Example: --max-content 2000',
            );
        }
        // Navigate to the answer page itself: this both seeds the
        // cookie/anti-bot context and works even when the caller did
        // not supply the parent question id (Zhihu redirects from
        // `/answer/<aid>` to the canonical `/question/<qid>/answer/<aid>`).
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
        const apiUrl = `https://www.zhihu.com/api/v4/answers/${answerId}?include=content,voteup_count,comment_count,author,created_time,updated_time,question`;
        const data = await page.evaluate(`
      (async () => {
        const r = await fetch(${JSON.stringify(apiUrl)}, { credentials: 'include' });
        if (!r.ok) return { __httpError: r.status };
        try {
          return await r.json();
        } catch (error) {
          return { __malformedJson: error instanceof Error ? error.message : String(error) };
        }
      })()
    `).catch((err) => {
            throw new CommandExecutionError(
                `Zhihu answer detail request failed: ${err instanceof Error ? err.message : String(err)}`,
                'Try again later or rerun with -v for more detail.',
            );
        });
        if (!data || data.__httpError) {
            const status = data?.__httpError;
            if (status === 401 || status === 403) {
                throw new AuthRequiredError('www.zhihu.com', 'Failed to fetch Zhihu answer detail');
            }
            if (status === 404) {
                throw new EmptyResultError('zhihu answer-detail', `No Zhihu answer was found for ${answerId}.`);
            }
            throw new CommandExecutionError(
                status
                    ? `Zhihu answer detail request failed (HTTP ${status})`
                    : 'Zhihu answer detail request failed',
                'Try again later or rerun with -v for more detail',
            );
        }
        if (data.__malformedJson) {
            throw new CommandExecutionError(
                `Zhihu answer detail returned malformed JSON: ${data.__malformedJson}`,
                'Try again later or rerun with -v for more detail',
            );
        }
        if (typeof data !== 'object' || Array.isArray(data)) {
            throw new CommandExecutionError(
                'Zhihu answer detail returned a malformed payload',
                'Try again later or rerun with -v for more detail',
            );
        }
        if (data.error || data.error_msg || data.message) {
            throw new CommandExecutionError(
                `Zhihu answer detail returned an error payload: ${data.error?.message || data.error_msg || data.message}`,
                'Try again later or rerun with -v for more detail',
            );
        }
        if (!Object.prototype.hasOwnProperty.call(data, 'content')) {
            throw new CommandExecutionError(
                'Zhihu answer detail payload did not include answer content',
                'Try again later or rerun with -v for more detail',
            );
        }
        const question = data.question || {};
        // Answer ids and newer question ids can exceed
        // Number.MAX_SAFE_INTEGER. Prefer ids parsed from user input or
        // the canonical redirected URL; only fall back to API numeric ids
        // when no string-safe source is available.
        const questionId = target.questionId
            || currentQuestionId
            || extractQuestionIdFromAnswerUrl(question.url)
            || (question.id == null ? '' : String(question.id));
        const stripped = stripHtml(data.content || '');
        // Truncation is opt-in only; default `maxContent === 0` short-
        // circuits the conditional so the full stripped body is returned.
        const content = maxContent > 0 && stripped.length > maxContent
            ? stripped.substring(0, maxContent)
            : stripped;
        return [{
            id: answerId,
            author: data.author?.name || 'anonymous',
            votes: normalizeCount(data.voteup_count),
            comments: normalizeCount(data.comment_count),
            question_id: questionId,
            question_title: question.title || '',
            url: questionId
                ? `https://www.zhihu.com/question/${questionId}/answer/${answerId}`
                : `https://www.zhihu.com/answer/${answerId}`,
            created_at: normalizeUnixSeconds(data.created_time),
            updated_at: normalizeUnixSeconds(data.updated_time),
            content,
        }];
    },
});

export const __test__ = { stripHtml, extractAnswerId, parseAnswerTarget, extractQuestionIdFromAnswerUrl };
