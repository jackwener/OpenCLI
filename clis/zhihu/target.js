import { CliError } from '@jackwener/opencli/errors';
const USER_RE = /^user:([A-Za-z0-9_-]+)$/;
const QUESTION_RE = /^question:(\d+)$/;
const ANSWER_RE = /^answer:(\d+):(\d+)$/;
const ARTICLE_RE = /^article:(\d+)$/;
const USER_PATH_RE = /^\/people\/([A-Za-z0-9_-]+)\/?$/;
const QUESTION_PATH_RE = /^\/question\/(\d+)\/?$/;
const ANSWER_PATH_RE = /^\/question\/(\d+)\/answer\/(\d+)\/?$/;
const ARTICLE_PATH_RE = /^\/p\/(\d+)\/?$/;
const EMPTY_AUTHORITY_RE = /^https:\/\/(?::)?@/i;
function isAllowedZhihuUrl(url) {
    return url.protocol === 'https:' && url.username === '' && url.password === '' && url.port === '';
}
export function parseTarget(input) {
    const value = String(input).trim();
    if (EMPTY_AUTHORITY_RE.test(value)) {
        throw new CliError('INVALID_INPUT', 'Zhihu write commands require a normal HTTPS Zhihu URL without malformed authority', 'Example: https://www.zhihu.com/question/123456');
    }
    if (value.startsWith('answer:') && !ANSWER_RE.test(value)) {
        throw new CliError('INVALID_INPUT', 'Invalid answer target, expected answer:<questionId>:<answerId>', 'Example: opencli zhihu like answer:123:456 --execute');
    }
    let match = value.match(USER_RE);
    if (match) {
        return { kind: 'user', slug: match[1], url: `https://www.zhihu.com/people/${match[1]}` };
    }
    match = value.match(QUESTION_RE);
    if (match) {
        return { kind: 'question', id: match[1], url: `https://www.zhihu.com/question/${match[1]}` };
    }
    match = value.match(ANSWER_RE);
    if (match) {
        return {
            kind: 'answer',
            questionId: match[1],
            id: match[2],
            url: `https://www.zhihu.com/question/${match[1]}/answer/${match[2]}`,
        };
    }
    match = value.match(ARTICLE_RE);
    if (match) {
        return { kind: 'article', id: match[1], url: `https://zhuanlan.zhihu.com/p/${match[1]}` };
    }
    try {
        const url = new URL(value);
        if (!isAllowedZhihuUrl(url)) {
            throw new Error('unsupported zhihu url variant');
        }
        if (url.hostname === 'www.zhihu.com') {
            const userMatch = url.pathname.match(USER_PATH_RE);
            if (userMatch) {
                const slug = userMatch[1];
                return { kind: 'user', slug, url: `https://www.zhihu.com/people/${slug}` };
            }
            const questionMatch = url.pathname.match(QUESTION_PATH_RE);
            if (questionMatch) {
                return { kind: 'question', id: questionMatch[1], url: `https://www.zhihu.com/question/${questionMatch[1]}` };
            }
            const answerMatch = url.pathname.match(ANSWER_PATH_RE);
            if (answerMatch) {
                return {
                    kind: 'answer',
                    questionId: answerMatch[1],
                    id: answerMatch[2],
                    url: `https://www.zhihu.com/question/${answerMatch[1]}/answer/${answerMatch[2]}`,
                };
            }
        }
        if (url.hostname === 'zhuanlan.zhihu.com') {
            const articleMatch = url.pathname.match(ARTICLE_PATH_RE);
            if (articleMatch) {
                return { kind: 'article', id: articleMatch[1], url: `https://zhuanlan.zhihu.com/p/${articleMatch[1]}` };
            }
        }
    }
    catch { }
    throw new CliError('INVALID_INPUT', 'Zhihu write commands require a Zhihu URL or typed target like question:123 or answer:123:456', 'Example: opencli zhihu like answer:123:456 --execute');
}
export function assertAllowedKinds(command, target) {
    const allowed = {
        follow: ['user', 'question'],
        like: ['answer', 'article'],
        favorite: ['answer', 'article'],
        comment: ['answer', 'article'],
        answer: ['question'],
    };
    if (!allowed[command]?.includes(target.kind)) {
        throw new CliError('UNSUPPORTED_TARGET', `zhihu ${command} does not support ${target.kind} targets`);
    }
    return target;
}
export const __test__ = { parseTarget, assertAllowedKinds };
