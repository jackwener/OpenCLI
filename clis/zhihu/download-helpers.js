import { AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { normalizeUnixSeconds } from './answer-normalize.js';
import { parseAnswerTarget } from './answer-target.js';
import { unwrapEvaluateResult } from './paginate.js';

const ARTICLE_TYPED_RE = /^article:(\d+)$/;
const ARTICLE_PATH_RE = /^\/p\/(\d+)\/?$/;
const ANSWER_API_PATH_RE = /^(?:\/api\/v4)?\/answers\/(\d+)\/?$/;
const QUESTION_API_PATH_RE = /^(?:\/api\/v4)?\/questions\/(\d+)\/?$/;
const QUESTION_WEB_PATH_RE = /^\/question\/(\d+)\/?$/;

export function parseDownloadTarget(input) {
    const value = String(input ?? '').trim();
    const typedArticle = value.match(ARTICLE_TYPED_RE);
    if (typedArticle) return articleTarget(typedArticle[1]);
    try {
        const url = new URL(value);
        const articleId = url.protocol === 'https:' && !url.username && !url.password && !url.port
            && url.hostname === 'zhuanlan.zhihu.com'
            ? url.pathname.match(ARTICLE_PATH_RE)?.[1]
            : '';
        if (articleId) return articleTarget(articleId);
    }
    catch {
        // The shared answer parser also accepts bare and typed answer ids.
    }
    const answer = parseAnswerTarget(value);
    return answer ? { kind: 'answer', ...answer } : null;
}

function articleTarget(articleId) {
    return { kind: 'article', articleId, url: `https://zhuanlan.zhihu.com/p/${articleId}` };
}

function trustedZhihuUrl(input) {
    if (typeof input !== 'string' || !input) return '';
    try {
        const url = new URL(input);
        if (url.protocol !== 'https:' || url.username || url.password || url.port
            || url.hash || !['api.zhihu.com', 'www.zhihu.com', 'zhihu.com'].includes(url.hostname)) return null;
        return url;
    }
    catch {
        return null;
    }
}

function answerTargetFromUrl(input) {
    const url = trustedZhihuUrl(input);
    if (!url) return null;
    const webTarget = parseAnswerTarget(url.toString());
    const apiAnswerId = url.pathname.match(ANSWER_API_PATH_RE)?.[1];
    return webTarget || (apiAnswerId ? { answerId: apiAnswerId, questionId: '' } : null);
}

function questionIdFromUrl(input) {
    const url = trustedZhihuUrl(input);
    if (!url) return '';
    return url.pathname.match(QUESTION_API_PATH_RE)?.[1] || url.pathname.match(QUESTION_WEB_PATH_RE)?.[1] || '';
}

export function normalizeContentImages(contentHtml, documentRef = document) {
    const root = documentRef.createElement('div');
    root.innerHTML = typeof contentHtml === 'string' ? contentHtml : '';
    const imageUrls = [];
    const seen = new Set();
    const normalizeUrl = (raw) => {
        const value = String(raw || '').trim();
        if (!value) return '';
        try {
            const url = new URL(value, 'https://www.zhihu.com/');
            return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.toString() : '';
        }
        catch {
            return '';
        }
    };
    const normalizeSrcset = (raw) => String(raw || '').split(',').flatMap((entry) => {
        const [url, ...descriptor] = entry.trim().split(/\s+/);
        const normalized = normalizeUrl(url);
        return normalized ? [[normalized, ...descriptor].join(' ')] : [];
    });
    const lastSrcsetUrl = (raw) => normalizeSrcset(raw).at(-1)?.split(/\s+/, 1)[0] || '';

    root.querySelectorAll('img, source').forEach((element) => {
        const srcset = normalizeSrcset(element.getAttribute('data-srcset') || element.getAttribute('srcset'));
        if (srcset.length) element.setAttribute('srcset', srcset.join(', '));
        else element.removeAttribute('srcset');
        element.removeAttribute('data-srcset');
    });
    root.querySelectorAll('img').forEach((img) => {
        const source = img.closest('picture')?.querySelector('source');
        const src = normalizeUrl(
            img.getAttribute('data-original') || img.getAttribute('data-actualsrc') || img.getAttribute('data-src')
            || lastSrcsetUrl(img.getAttribute('srcset')) || lastSrcsetUrl(source?.getAttribute('srcset'))
            || img.getAttribute('src'),
        );
        for (const name of ['data-original', 'data-actualsrc', 'data-src']) img.removeAttribute(name);
        if (!src) img.removeAttribute('src');
        else {
            img.setAttribute('src', src);
            if (!seen.has(src)) {
                seen.add(src);
                imageUrls.push(src);
            }
        }
    });
    return { contentHtml: root.innerHTML, imageUrls };
}

function requireArticle(raw) {
    const data = unwrapEvaluateResult(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)
        || typeof data.title !== 'string' || typeof data.contentHtml !== 'string'
        || !Array.isArray(data.imageUrls) || !data.imageUrls.every((url) => typeof url === 'string')) {
        throw new CommandExecutionError('Zhihu column download returned malformed article fields');
    }
    if (!data.contentHtml.trim()) {
        throw new EmptyResultError('zhihu download', 'The Zhihu column article had no exportable content.');
    }
    return data;
}

export async function extractColumnArticle(page, target) {
    await page.goto(target.url);
    await page.wait(3);
    const normalize = `(${normalizeContentImages.toString()})`;
    const raw = await page.evaluate(`
      (() => {
        const content = document.querySelector('.Post-RichTextContainer, .RichText, .ArticleContent');
        const normalized = ${normalize}(content?.innerHTML || '');
        return {
          title: document.querySelector('.Post-Title, h1.ContentItem-title, .ArticleTitle')?.textContent?.trim() || 'untitled',
          author: document.querySelector('.AuthorInfo-name, .UserLink-link')?.textContent?.trim() || '',
          publishTime: document.querySelector('.ContentItem-time, .Post-Time')?.textContent?.trim() || '',
          ...normalized
        };
      })()
    `).catch((error) => {
        throw new CommandExecutionError(`Zhihu column extraction failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    return requireArticle(raw);
}

export async function extractAnswer(page, target) {
    try {
        await page.goto(`https://www.zhihu.com/answer/${target.answerId}`);
    }
    catch (error) {
        throw new CommandExecutionError(
            `Failed to open Zhihu answer ${target.answerId}: ${error instanceof Error ? error.message : String(error)}`,
            'Open the answer URL in Chrome and retry after the page is reachable.',
        );
    }
    const currentUrl = typeof page.getCurrentUrl === 'function' ? await page.getCurrentUrl().catch(() => '') : '';
    const currentTarget = parseAnswerTarget(currentUrl);
    if (!currentTarget || currentTarget.answerId !== target.answerId || !currentTarget.questionId
        || (target.questionId && currentTarget.questionId && target.questionId !== currentTarget.questionId)) {
        throw new CommandExecutionError(`Zhihu answer navigation changed identity for answer ${target.answerId}`);
    }

    const apiUrl = `https://www.zhihu.com/api/v4/answers/${target.answerId}?include=content,author,created_time,question,url`;
    const normalize = `(${normalizeContentImages.toString()})`;
    const raw = await page.evaluate(`
      (async () => {
        let response;
        try {
          response = await fetch(${JSON.stringify(apiUrl)}, { credentials: 'include' });
        } catch (error) {
          return { fetchError: error instanceof Error ? error.message : String(error) };
        }
        let payload;
        try {
          payload = await response.json();
        } catch {
          return { status: response.status, malformed: true };
        }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { status: response.status, malformed: true };
        const errorCode = payload.error?.code ?? '';
        const errorMessage = payload.error?.message || payload.error_msg || payload.message || '';
        const needLogin = payload.error?.need_login === true || payload.need_login === true;
        if (!response.ok || errorCode || errorMessage || needLogin) {
          return { status: response.status, errorCode, errorMessage, needLogin };
        }
        if (typeof payload.content !== 'string') return { malformed: true };
        const normalized = ${normalize}(payload.content, document);
        return { value: {
          answerUrl: typeof payload.url === 'string' ? payload.url : '',
          questionUrl: typeof payload.question?.url === 'string' ? payload.question.url : '',
          title: typeof payload.question?.title === 'string' ? payload.question.title : '',
          author: typeof payload.author?.name === 'string' ? payload.author.name : '',
          createdTime: payload.created_time,
          ...normalized
        } };
      })()
    `).catch((error) => {
        throw new CommandExecutionError(
            `Zhihu answer download request failed: ${error instanceof Error ? error.message : String(error)}`,
            'Try again later or rerun with -v for more detail.',
        );
    });

    const data = unwrapEvaluateResult(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new CommandExecutionError('Zhihu answer download returned a malformed Browser Bridge payload');
    }
    const status = data.status;
    if (String(data.errorCode) === '40362') {
        throw new CommandExecutionError(
            `Zhihu risk control blocked answer ${target.answerId} (40362): ${data.errorMessage || 'abnormal request'}`,
            'Open the answer in the connected Chrome profile and retry later.',
        );
    }
    if (status === 401 || status === 403 || String(data.errorCode) === '40353' || data.needLogin) {
        throw new AuthRequiredError('www.zhihu.com', 'Failed to download Zhihu answer');
    }
    if (status === 404) {
        throw new EmptyResultError('zhihu download', `No Zhihu answer was found for ${target.answerId}.`);
    }
    if (status || data.fetchError) {
        throw new CommandExecutionError(
            status ? `Zhihu answer download request failed (HTTP ${status})` : 'Zhihu answer download request failed',
            String(data.fetchError || data.errorMessage || 'Try again later or rerun with -v for more detail.'),
        );
    }
    if (data.malformed || data.errorCode || data.errorMessage) {
        throw new CommandExecutionError('Zhihu answer download returned a malformed or error payload');
    }

    const value = data.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || typeof value.contentHtml !== 'string' || !Array.isArray(value.imageUrls)
        || !value.imageUrls.every((url) => typeof url === 'string')) {
        throw new CommandExecutionError('Zhihu answer download returned malformed answer fields');
    }
    if (!value.contentHtml.trim()) {
        throw new EmptyResultError('zhihu download', `Zhihu answer ${target.answerId} had no exportable content.`);
    }
    const payloadAnswerTarget = answerTargetFromUrl(value.answerUrl);
    const payloadQuestionId = value.questionUrl ? questionIdFromUrl(value.questionUrl) : '';
    if (!payloadAnswerTarget || payloadAnswerTarget.answerId !== target.answerId) {
        throw new CommandExecutionError(`Zhihu answer payload did not match requested answer ${target.answerId}`);
    }
    if (!payloadQuestionId) {
        throw new CommandExecutionError('Zhihu answer download returned an untrusted question URL');
    }
    const questionId = target.questionId || currentTarget.questionId || payloadQuestionId;
    if (!questionId || payloadQuestionId !== questionId
        || (payloadAnswerTarget.questionId && payloadAnswerTarget.questionId !== questionId)) {
        throw new CommandExecutionError(`Zhihu answer payload changed question identity for answer ${target.answerId}`);
    }
    const title = typeof value.title === 'string' && value.title.trim() ? value.title.trim() : 'Zhihu answer';
    return {
        title: `${target.answerId} - ${title}`,
        author: typeof value.author === 'string' ? value.author : '',
        publishTime: normalizeUnixSeconds(value.createdTime),
        sourceUrl: questionId
            ? `https://www.zhihu.com/question/${questionId}/answer/${target.answerId}`
            : `https://www.zhihu.com/answer/${target.answerId}`,
        contentHtml: value.contentHtml,
        imageUrls: value.imageUrls,
    };
}
