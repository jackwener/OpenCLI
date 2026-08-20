import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { downloadArticle } from '@jackwener/opencli/download/article-download';

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
import { __test__ as helpers } from './download.js';

beforeEach(() => {
    vi.clearAllMocks();
});

describe('zhihu download', () => {
    it('registers as a cookie read command for articles and answers', () => {
        const cmd = getRegistry().get('zhihu/download');
        expect(cmd).toBeDefined();
        expect(cmd.access).toBe('read');
        expect(cmd.strategy).toBe('cookie');
        expect(cmd.description).toContain('回答');
    });

    it('exports raw answer HTML and normalized image URLs through downloadArticle', async () => {
        const cmd = getRegistry().get('zhihu/download');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            getCurrentUrl: vi.fn().mockResolvedValue('https://www.zhihu.com/question/1918304251865699164/answer/2043281635827766181'),
            evaluate: vi.fn().mockResolvedValue({
                title: 'Question title',
                author: 'alice',
                createdTime: 1700000000,
                contentHtml: '<p>body</p><img src="https://pic.example/no-extension">',
                imageUrls: ['https://pic.example/no-extension'],
            }),
        };

        await expect(cmd.func(page, {
            url: 'https://www.zhihu.com/question/1918304251865699164/answer/2043281635827766181',
            output: '/tmp/zhihu',
            'download-images': true,
        })).resolves.toMatchObject([{ status: 'success' }]);

        expect(page.goto).toHaveBeenCalledWith('https://www.zhihu.com/answer/2043281635827766181');
        expect(page.evaluate.mock.calls[0][0]).toContain('function normalizeContentImages');
        expect(downloadArticle).toHaveBeenCalledWith({
            title: 'Question title',
            author: 'alice',
            publishTime: '2023-11-14T22:13:20.000Z',
            sourceUrl: 'https://www.zhihu.com/question/1918304251865699164/answer/2043281635827766181',
            contentHtml: '<p>body</p><img src="https://pic.example/no-extension">',
            imageUrls: ['https://pic.example/no-extension'],
        }, {
            output: '/tmp/zhihu',
            downloadImages: true,
            imageHeaders: { Referer: 'https://www.zhihu.com/' },
        });
    });

    it('keeps the existing column article flow', async () => {
        const cmd = getRegistry().get('zhihu/download');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({
                title: 'Column title',
                author: 'bob',
                publishTime: 'today',
                contentHtml: '<p>column</p>',
                imageUrls: [],
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
    });

    it('distinguishes Zhihu risk control from an auth failure', async () => {
        const cmd = getRegistry().get('zhihu/download');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            getCurrentUrl: vi.fn().mockResolvedValue('https://www.zhihu.com/answer/1'),
            evaluate: vi.fn().mockResolvedValue({
                __httpError: 403,
                __errorCode: 40362,
                __errorMessage: 'abnormal request',
            }),
        };

        const promise = cmd.func(page, { url: '1', output: '/tmp/zhihu', 'download-images': false });
        await expect(promise).rejects.toBeInstanceOf(CommandExecutionError);
        await expect(cmd.func(page, { url: '1', output: '/tmp/zhihu', 'download-images': false }))
            .rejects.not.toBeInstanceOf(AuthRequiredError);
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

describe('zhihu download target parsing', () => {
    it('accepts exact article and answer target forms with string-safe ids', () => {
        expect(helpers.parseDownloadTarget('2043281635827766181')).toEqual({
            kind: 'answer', answerId: '2043281635827766181', questionId: '',
        });
        expect(helpers.parseDownloadTarget('answer:1918304251865699164:2043281635827766181')).toEqual({
            kind: 'answer', questionId: '1918304251865699164', answerId: '2043281635827766181',
        });
        expect(helpers.parseDownloadTarget('article:123')).toEqual({
            kind: 'article', articleId: '123', url: 'https://zhuanlan.zhihu.com/p/123',
        });
        expect(helpers.parseDownloadTarget('https://www.zhihu.com/question/10/answer/20?share=1')).toEqual({
            kind: 'answer', questionId: '10', answerId: '20',
        });
    });

    it('rejects lookalike hosts and unrelated Zhihu paths', () => {
        expect(helpers.parseDownloadTarget('https://www.zhihu.com.evil.example/question/10/answer/20')).toBeNull();
        expect(helpers.parseDownloadTarget('https://www.zhihu.com/question/10')).toBeNull();
        expect(helpers.parseDownloadTarget('')).toBeNull();
    });

    it('normalizes lazy and protocol-relative image sources in detached answer HTML', () => {
        const sourceDom = new JSDOM();
        const normalized = helpers.normalizeContentImages(`
            <p>body</p>
            <img src="https://pic.example/fallback.png" data-original="https://pic.example/original.png">
            <img src="https://pic.example/original.png">
            <img data-actualsrc="//pic.example/protocol-relative.svg">
            <img src="data:image/png;base64,AAAA">
        `, sourceDom.window.document);
        const resultDom = new JSDOM(normalized.contentHtml);
        const images = [...resultDom.window.document.querySelectorAll('img')];

        expect(normalized.imageUrls).toEqual([
            'https://pic.example/original.png',
            'https://pic.example/protocol-relative.svg',
        ]);
        expect(images.map((img) => img.getAttribute('src'))).toEqual([
            'https://pic.example/original.png',
            'https://pic.example/original.png',
            'https://pic.example/protocol-relative.svg',
            'data:image/png;base64,AAAA',
        ]);
    });
});
