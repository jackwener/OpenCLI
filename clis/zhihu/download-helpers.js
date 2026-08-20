import { AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const ANSWER_ID_RE = /^\d+$/;
const ANSWER_TYPED_RE = /^answer:(\d+):(\d+)$/;
const ANSWER_PATH_RE = /^\/question\/(\d+)\/answer\/(\d+)\/?$/;
const BARE_ANSWER_PATH_RE = /^\/answer\/(\d+)\/?$/;
const ARTICLE_TYPED_RE = /^article:(\d+)$/;
const ARTICLE_PATH_RE = /^\/p\/(\d+)\/?$/;

export function parseDownloadTarget(input) {
    const value = String(input ?? '').trim();
    if (!value) return null;
    if (ANSWER_ID_RE.test(value)) return { kind: 'answer', answerId: value, questionId: '' };
    const typedAnswer = value.match(ANSWER_TYPED_RE);
    if (typedAnswer) return { kind: 'answer', questionId: typedAnswer[1], answerId: typedAnswer[2] };
    const typedArticle = value.match(ARTICLE_TYPED_RE);
    if (typedArticle) return { kind: 'article', articleId: typedArticle[1], url: `https://zhuanlan.zhihu.com/p/${typedArticle[1]}` };
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
        if (url.hostname === 'zhuanlan.zhihu.com') {
            const article = url.pathname.match(ARTICLE_PATH_RE);
            return article
                ? { kind: 'article', articleId: article[1], url: `https://zhuanlan.zhihu.com/p/${article[1]}` }
                : null;
        }
        if (url.hostname !== 'www.zhihu.com' && url.hostname !== 'zhihu.com') return null;
        const answer = url.pathname.match(ANSWER_PATH_RE);
        if (answer) return { kind: 'answer', questionId: answer[1], answerId: answer[2] };
        const bareAnswer = url.pathname.match(BARE_ANSWER_PATH_RE);
        return bareAnswer ? { kind: 'answer', questionId: '', answerId: bareAnswer[1] } : null;
    } catch {
        return null;
    }
}

export function extractQuestionId(url) {
    try {
        const parsed = new URL(String(url || ''));
        if (parsed.protocol !== 'https:' || (parsed.hostname !== 'www.zhihu.com' && parsed.hostname !== 'zhihu.com')) return '';
        return parsed.pathname.match(ANSWER_PATH_RE)?.[1] || '';
    } catch {
        return '';
    }
}

export function normalizeUnixSeconds(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? new Date(value * 1000).toISOString()
        : '';
}

export function normalizeContentImages(contentHtml, documentRef = document) {
    const root = documentRef.createElement('div');
    root.innerHTML = contentHtml || '';
    const imageUrls = [];
    const seen = new Set();
    root.querySelectorAll('img').forEach((img) => {
        const src = img.getAttribute('data-original') || img.getAttribute('data-actualsrc') || img.getAttribute('src') || '';
        if (!src || src.startsWith('data:')) return;
        const normalized = src.startsWith('//') ? `https:${src}` : src;
        img.setAttribute('src', normalized);
        if (!seen.has(normalized)) {
            seen.add(normalized);
            imageUrls.push(normalized);
        }
    });
    return { contentHtml: root.innerHTML, imageUrls };
}

export async function extractColumnArticle(page, target) {
    await page.goto(target.url);
    await page.wait(3);
    return page.evaluate(`
      (() => {
        const result = {
          title: '',
          author: '',
          publishTime: '',
          contentHtml: '',
          imageUrls: []
        };
        const titleEl = document.querySelector('.Post-Title, h1.ContentItem-title, .ArticleTitle');
        result.title = titleEl?.textContent?.trim() || 'untitled';
        const authorEl = document.querySelector('.AuthorInfo-name, .UserLink-link');
        result.author = authorEl?.textContent?.trim() || '';
        const timeEl = document.querySelector('.ContentItem-time, .Post-Time');
        result.publishTime = timeEl?.textContent?.trim() || '';
        const contentEl = document.querySelector('.Post-RichTextContainer, .RichText, .ArticleContent');
        if (contentEl) {
          const clone = contentEl.cloneNode(true);
          const seen = new Set();
          clone.querySelectorAll('img').forEach(img => {
            const src = img.getAttribute('data-original') || img.getAttribute('data-actualsrc') || img.getAttribute('src') || '';
            if (!src || src.startsWith('data:')) return;
            const normalized = src.startsWith('//') ? 'https:' + src : src;
            img.setAttribute('src', normalized);
            if (!seen.has(normalized)) {
              seen.add(normalized);
              result.imageUrls.push(normalized);
            }
          });
          result.contentHtml = clone.innerHTML;
        }
        return result;
      })()
    `);
}

export async function extractAnswer(page, target) {
    try {
        await page.goto(`https://www.zhihu.com/answer/${target.answerId}`);
    } catch (err) {
        throw new CommandExecutionError(
            `Failed to open Zhihu answer ${target.answerId}: ${err instanceof Error ? err.message : String(err)}`,
            'Open the answer URL in Chrome and retry after the page is reachable.',
        );
    }
    const currentUrl = page.getCurrentUrl ? await page.getCurrentUrl().catch(() => '') : '';
    const apiUrl = `https://www.zhihu.com/api/v4/answers/${target.answerId}?include=content,author,created_time,question`;
    const normalizeContentImagesSource = `(${normalizeContentImages.toString()})`;
    const data = await page.evaluate(`
      (async () => {
        const response = await fetch(${JSON.stringify(apiUrl)}, { credentials: 'include' });
        let payload;
        try {
          payload = await response.json();
        } catch (error) {
          return { __httpError: response.status, __malformedJson: error instanceof Error ? error.message : String(error) };
        }
        const errorCode = payload?.error?.code ?? '';
        const errorMessage = payload?.error?.message || payload?.error_msg || payload?.message || '';
        if (!response.ok) return { __httpError: response.status, __errorCode: errorCode, __errorMessage: errorMessage };
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { __malformedPayload: true };
        if (errorCode || errorMessage) return { __errorCode: errorCode, __errorMessage: errorMessage };
        if (!Object.prototype.hasOwnProperty.call(payload, 'content')) return { __missingContent: true };

        const normalizedContent = ${normalizeContentImagesSource}(payload.content || '');
        return {
          title: payload.question?.title || 'untitled',
          author: payload.author?.name || '',
          createdTime: payload.created_time,
          contentHtml: normalizedContent.contentHtml,
          imageUrls: normalizedContent.imageUrls,
        };
      })()
    `).catch((err) => {
        throw new CommandExecutionError(
            `Zhihu answer download request failed: ${err instanceof Error ? err.message : String(err)}`,
            'Try again later or rerun with -v for more detail.',
        );
    });

    if (!data || data.__httpError) {
        const status = data?.__httpError;
        if (status === 403 && String(data?.__errorCode) === '40362') {
            throw new CommandExecutionError(
                `Zhihu risk control blocked answer ${target.answerId} (40362): ${data?.__errorMessage || 'abnormal request'}`,
                'Open the answer in the connected Chrome profile and retry later.',
            );
        }
        if (status === 401 || status === 403) {
            throw new AuthRequiredError('www.zhihu.com', 'Failed to download Zhihu answer');
        }
        if (status === 404) {
            throw new EmptyResultError('zhihu download', `No Zhihu answer was found for ${target.answerId}.`);
        }
        throw new CommandExecutionError(
            status ? `Zhihu answer download request failed (HTTP ${status})` : 'Zhihu answer download request failed',
            'Try again later or rerun with -v for more detail.',
        );
    }
    if (data.__malformedJson || data.__malformedPayload || data.__missingContent) {
        throw new CommandExecutionError('Zhihu answer download returned a malformed payload');
    }
    if (data.__errorCode || data.__errorMessage) {
        throw new CommandExecutionError(`Zhihu answer download returned an error payload: ${data.__errorMessage || data.__errorCode}`);
    }

    const questionId = target.questionId || extractQuestionId(currentUrl);
    return {
        title: data.title || 'untitled',
        author: data.author || '',
        publishTime: normalizeUnixSeconds(data.createdTime),
        sourceUrl: questionId
            ? `https://www.zhihu.com/question/${questionId}/answer/${target.answerId}`
            : `https://www.zhihu.com/answer/${target.answerId}`,
        contentHtml: data.contentHtml || '',
        imageUrls: data.imageUrls || [],
    };
}
