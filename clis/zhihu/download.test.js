import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { downloadArticle } from '@jackwener/opencli/download/article-download';
import { normalizeContentImages, parseDownloadTarget } from './download-helpers.js';

vi.mock('@jackwener/opencli/download/article-download', () => ({
    downloadArticle: vi.fn(async (data) => [{
        title: data.title,
        author: data.author || '-',
        publish_time: data.publishTime || '-',
        status: 'success',
        size: '1 KB',
        saved: '/tmp/export.md',
    }]),
}));

import './download.js';

const QUESTION_ID = '1918304251865699164';
const ANSWER_ID = '2043281635827766181';

function answerValue(overrides = {}) {
    return {
        answerUrl: `https://api.zhihu.com/answers/${ANSWER_ID}`,
        questionUrl: `https://api.zhihu.com/questions/${QUESTION_ID}`,
        title: 'Question title',
        author: 'alice',
        createdTime: 1700000000,
        contentHtml: '<p>body</p><img src="https://pic.example/no-extension">',
        imageUrls: ['https://pic.example/no-extension'],
        ...overrides,
    };
}

function answerPage(evaluateResult = { value: answerValue() }, currentUrl = `https://www.zhihu.com/question/${QUESTION_ID}/answer/${ANSWER_ID}`) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        getCurrentUrl: vi.fn().mockResolvedValue(currentUrl),
        evaluate: vi.fn().mockResolvedValue(evaluateResult),
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('zhihu download', () => {
    it('registers a dynamic-navigation cookie read command for articles and answers', () => {
        const cmd = getRegistry().get('zhihu/download');
        expect(cmd).toBeDefined();
        expect(cmd.access).toBe('read');
        expect(cmd.strategy).toBe('cookie');
        expect(cmd.navigateBefore).toBe(false);
        expect(cmd.description).toContain('回答');
    });

    it('exports same-head Browser Bridge answer payloads through downloadArticle', async () => {
        const cmd = getRegistry().get('zhihu/download');
        const page = answerPage({ session: 'bridge-session', data: { value: answerValue() } });

        await expect(cmd.func(page, {
            url: `https://www.zhihu.com/question/${QUESTION_ID}/answer/${ANSWER_ID}`,
            output: '/tmp/zhihu',
            'download-images': true,
        })).resolves.toMatchObject([{ status: 'success' }]);

        expect(page.goto).toHaveBeenCalledWith(`https://www.zhihu.com/answer/${ANSWER_ID}`);
        expect(downloadArticle).toHaveBeenCalledWith({
            title: `${ANSWER_ID} - Question title`,
            author: 'alice',
            publishTime: '2023-11-14T22:13:20.000Z',
            sourceUrl: `https://www.zhihu.com/question/${QUESTION_ID}/answer/${ANSWER_ID}`,
            contentHtml: '<p>body</p><img src="https://pic.example/no-extension">',
            imageUrls: ['https://pic.example/no-extension'],
        }, {
            output: '/tmp/zhihu',
            downloadImages: true,
            imageHeaders: { Referer: 'https://www.zhihu.com/' },
            requireImageContentType: true,
        });
    });

    it('keeps the existing column article flow and its URL-derived image extensions', async () => {
        const cmd = getRegistry().get('zhihu/download');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({
                session: 'bridge-session',
                data: {
                    title: 'Column title',
                    author: 'bob',
                    publishTime: 'today',
                    contentHtml: '<p>column</p>',
                    imageUrls: [],
                },
            }),
        };

        await cmd.func(page, {
            url: 'https://zhuanlan.zhihu.com/p/123?utm_source=test',
            output: '/tmp/zhihu',
            'download-images': false,
        });

        expect(page.goto).toHaveBeenCalledWith('https://zhuanlan.zhihu.com/p/123');
        expect(page.wait).toHaveBeenCalledWith(3);
        expect(downloadArticle).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Column title',
            sourceUrl: 'https://zhuanlan.zhihu.com/p/123',
        }), expect.objectContaining({
            imageHeaders: { Referer: 'https://zhuanlan.zhihu.com/' },
        }));
        expect(downloadArticle.mock.calls[0][1]).not.toHaveProperty('requireImageContentType');
    });

    it('fails closed when navigation or API provenance changes answer identity', async () => {
        const cmd = getRegistry().get('zhihu/download');
        const wrongNavigation = answerPage(
            { value: answerValue() },
            `https://www.zhihu.com/question/${QUESTION_ID}/answer/999`,
        );
        await expect(cmd.func(wrongNavigation, { url: ANSWER_ID, output: '/tmp/zhihu' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
        expect(wrongNavigation.evaluate).not.toHaveBeenCalled();

        const wrongAnswer = answerPage({ value: answerValue({ answerUrl: 'https://api.zhihu.com/answers/999' }) });
        await expect(cmd.func(wrongAnswer, { url: ANSWER_ID, output: '/tmp/zhihu' }))
            .rejects.toBeInstanceOf(CommandExecutionError);

        const missingAnswer = answerPage({ value: answerValue({ answerUrl: '' }) });
        await expect(cmd.func(missingAnswer, { url: ANSWER_ID, output: '/tmp/zhihu' }))
            .rejects.toBeInstanceOf(CommandExecutionError);

        const hashedAnswer = answerPage({ value: answerValue({ answerUrl: `https://api.zhihu.com/answers/${ANSWER_ID}#other` }) });
        await expect(cmd.func(hashedAnswer, { url: ANSWER_ID, output: '/tmp/zhihu' }))
            .rejects.toBeInstanceOf(CommandExecutionError);

        const wrongQuestion = answerPage({
            value: answerValue({ questionUrl: 'https://www.zhihu.com/api/v4/questions/999' }),
        });
        await expect(cmd.func(wrongQuestion, {
            url: `answer:${QUESTION_ID}:${ANSWER_ID}`,
            output: '/tmp/zhihu',
        })).rejects.toBeInstanceOf(CommandExecutionError);

        const answerUrlAsQuestion = answerPage({
            value: answerValue({ questionUrl: `https://www.zhihu.com/question/${QUESTION_ID}/answer/999` }),
        });
        await expect(cmd.func(answerUrlAsQuestion, { url: ANSWER_ID, output: '/tmp/zhihu' }))
            .rejects.toBeInstanceOf(CommandExecutionError);

        const missingQuestion = answerPage({ value: answerValue({ questionUrl: '' }) });
        await expect(cmd.func(missingQuestion, { url: ANSWER_ID, output: '/tmp/zhihu' }))
            .rejects.toBeInstanceOf(CommandExecutionError);

        const missingNavigationQuestion = answerPage(
            { value: answerValue() },
            `https://www.zhihu.com/answer/${ANSWER_ID}`,
        );
        await expect(cmd.func(missingNavigationQuestion, { url: ANSWER_ID, output: '/tmp/zhihu' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it.each([
        [{ status: 403, errorCode: 40362, errorMessage: 'abnormal request' }, CommandExecutionError],
        [{ status: 401 }, AuthRequiredError],
        [{ errorCode: 40353, needLogin: true }, AuthRequiredError],
        [{ status: 404 }, EmptyResultError],
        [{ status: 500 }, CommandExecutionError],
        [{ fetchError: 'network down' }, CommandExecutionError],
        [{ malformed: true }, CommandExecutionError],
        [{ value: answerValue({ contentHtml: '' }) }, EmptyResultError],
    ])('maps answer fetch failures to typed errors', async (evaluateResult, ErrorClass) => {
        const cmd = getRegistry().get('zhihu/download');
        await expect(cmd.func(answerPage(evaluateResult), {
            url: ANSWER_ID,
            output: '/tmp/zhihu',
            'download-images': false,
        })).rejects.toBeInstanceOf(ErrorClass);
    });

    it('rejects malformed Browser Bridge envelopes and raw bridge failures', async () => {
        const cmd = getRegistry().get('zhihu/download');
        const malformed = answerPage({ session: 'bridge-session', data: null });
        await expect(cmd.func(malformed, { url: ANSWER_ID, output: '/tmp/zhihu' }))
            .rejects.toBeInstanceOf(CommandExecutionError);

        const failed = answerPage();
        failed.evaluate.mockRejectedValue(new Error('bridge disconnected'));
        await expect(cmd.func(failed, { url: ANSWER_ID, output: '/tmp/zhihu' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('rejects unsupported targets before browser navigation', async () => {
        const cmd = getRegistry().get('zhihu/download');
        const page = { goto: vi.fn(), evaluate: vi.fn() };
        await expect(cmd.func(page, { url: 'https://example.com/a', output: '/tmp/zhihu' }))
            .rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });
});

describe('zhihu download target and image normalization', () => {
    it('reuses exact string-safe answer targets and accepts exact article targets', () => {
        expect(parseDownloadTarget(ANSWER_ID)).toEqual({
            kind: 'answer', answerId: ANSWER_ID, questionId: '',
        });
        expect(parseDownloadTarget(`answer:${QUESTION_ID}:${ANSWER_ID}`)).toEqual({
            kind: 'answer', questionId: QUESTION_ID, answerId: ANSWER_ID,
        });
        expect(parseDownloadTarget('article:123')).toEqual({
            kind: 'article', articleId: '123', url: 'https://zhuanlan.zhihu.com/p/123',
        });
        expect(parseDownloadTarget('https://www.zhihu.com.evil.example/question/10/answer/20')).toBeNull();
        expect(parseDownloadTarget('https://www.zhihu.com/question/10')).toBeNull();
    });

    it('normalizes only downloadable lazy image and picture sources', () => {
        const sourceDom = new JSDOM();
        const normalized = normalizeContentImages(`
            <img src="fallback.png" data-original="/original.png">
            <img data-srcset="//pic.example/small.webp 1x, https://pic.example/large.webp 2x">
            <picture><source srcset="/small.svg 1x, /large.svg 2x"><img src="data:image/png;base64,AAAA"></picture>
            <img src="javascript:alert(1)">
        `, sourceDom.window.document);
        const resultDom = new JSDOM(normalized.contentHtml);
        const images = [...resultDom.window.document.querySelectorAll('img')];

        expect(normalized.imageUrls).toEqual([
            'https://www.zhihu.com/original.png',
            'https://pic.example/large.webp',
            'https://www.zhihu.com/large.svg',
        ]);
        expect(images.map((img) => img.getAttribute('src'))).toEqual([
            'https://www.zhihu.com/original.png',
            'https://pic.example/large.webp',
            'https://www.zhihu.com/large.svg',
            null,
        ]);
        expect(resultDom.window.document.querySelector('source')?.getAttribute('srcset'))
            .toBe('https://www.zhihu.com/small.svg 1x, https://www.zhihu.com/large.svg 2x');
    });
});
