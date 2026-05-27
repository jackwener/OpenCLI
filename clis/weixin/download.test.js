import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';

const { mockDownloadArticle } = vi.hoisted(() => ({
    mockDownloadArticle: vi.fn(),
}));

vi.mock('@jackwener/opencli/download/article-download', () => ({
    downloadArticle: mockDownloadArticle,
}));

// Import side-effect — registers `weixin/download` in the registry.
await import('./download.js');

describe('weixin download command', () => {
    const command = getRegistry().get('weixin/download');

    const extractedArticle = {
        title: '测试文章',
        author: '某公众号',
        publishTime: '2026-05-27',
        errorHint: '',
        contentHtml: '<p>正文内容</p>',
        codeBlocks: [],
        imageUrls: ['https://example.com/img.jpg'],
    };

    const verificationGatePayload = {
        title: '',
        author: '',
        publishTime: '',
        errorHint: 'environment verification required',
        contentHtml: '',
        codeBlocks: [],
        imageUrls: [],
    };

    let page;

    beforeEach(() => {
        vi.restoreAllMocks();
        mockDownloadArticle.mockReset();
        mockDownloadArticle.mockResolvedValue([{
            title: '测试文章',
            author: '某公众号',
            publish_time: '2026-05-27',
            status: 'success',
            size: '1 KB',
            saved: '/tmp/out/测试文章/测试文章.md',
        }]);
        page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue(extractedArticle),
        };
    });

    it('registers as a cookie-strategy browser command for mp.weixin.qq.com', () => {
        expect(command).toBeDefined();
        expect(command.site).toBe('weixin');
        expect(command.name).toBe('download');
        expect(command.strategy).toBe('cookie');
        expect(command.domain).toBe('mp.weixin.qq.com');
    });

    it('exposes a boolean --stdout flag defaulting to false', () => {
        const stdoutArg = command.args.find((a) => a.name === 'stdout');
        expect(stdoutArg).toBeDefined();
        expect(stdoutArg.type).toBe('boolean');
        expect(stdoutArg.default).toBe(false);
    });

    it('rejects non-mp.weixin.qq.com URLs before any browser navigation', async () => {
        const result = await command.func(page, {
            url: 'https://example.com/article',
            output: '/tmp/out',
            'download-images': false,
            stdout: false,
        });
        expect(result).toEqual([
            expect.objectContaining({ status: 'invalid URL' }),
        ]);
        expect(page.goto).not.toHaveBeenCalled();
    });

    describe('--stdout=true behavior', () => {
        it('passes stdout:true through to downloadArticle and returns null to suppress row output', async () => {
            const result = await command.func(page, {
                url: 'https://mp.weixin.qq.com/s/abc123',
                output: '/tmp/out',
                'download-images': true,
                stdout: true,
            });

            expect(result).toBeNull();
            expect(mockDownloadArticle).toHaveBeenCalledTimes(1);
            const [data, options] = mockDownloadArticle.mock.calls[0];
            expect(data).toEqual(expect.objectContaining({
                title: '测试文章',
                author: '某公众号',
                publishTime: '2026-05-27',
                sourceUrl: 'https://mp.weixin.qq.com/s/abc123',
                contentHtml: '<p>正文内容</p>',
            }));
            expect(options).toEqual(expect.objectContaining({
                output: '/tmp/out',
                downloadImages: true,
                stdout: true,
                imageHeaders: { Referer: 'https://mp.weixin.qq.com/' },
                frontmatterLabels: { author: '公众号' },
            }));
        });

        it('takes the errorHint early-return path BEFORE downloadArticle, even when --stdout=true', async () => {
            // Lock the §5 semantic: errorHint detection runs in-page (line 242 of download.js)
            // and short-circuits the cli func at line 294, never reaching downloadArticle().
            // --stdout has zero effect on this branch — it must return the structured
            // verification-required row regardless, so omnireach can read row.status
            // and surface captcha_suspected.
            page.evaluate.mockResolvedValue(verificationGatePayload);

            const result = await command.func(page, {
                url: 'https://mp.weixin.qq.com/s/blocked',
                output: '/tmp/out',
                'download-images': true,
                stdout: true,
            });

            expect(mockDownloadArticle).not.toHaveBeenCalled();
            expect(result).toEqual([
                expect.objectContaining({
                    title: 'Error',
                    status: expect.stringContaining('verification required'),
                }),
            ]);
        });
    });

    describe('--stdout=false (default) behavior', () => {
        it('passes stdout:false through to downloadArticle and returns the row payload unchanged', async () => {
            const savedRows = [{
                title: '测试文章',
                author: '某公众号',
                publish_time: '2026-05-27',
                status: 'success',
                size: '2 KB',
                saved: '/tmp/out/测试文章/测试文章.md',
            }];
            mockDownloadArticle.mockResolvedValue(savedRows);

            const result = await command.func(page, {
                url: 'https://mp.weixin.qq.com/s/abc123',
                output: '/tmp/out',
                'download-images': true,
                stdout: false,
            });

            expect(result).toBe(savedRows);
            const [, options] = mockDownloadArticle.mock.calls[0];
            expect(options.stdout).toBe(false);
        });

        it('returns the verification-required row when errorHint is set (no --stdout)', async () => {
            page.evaluate.mockResolvedValue(verificationGatePayload);

            const result = await command.func(page, {
                url: 'https://mp.weixin.qq.com/s/blocked',
                output: '/tmp/out',
                'download-images': true,
                stdout: false,
            });

            expect(mockDownloadArticle).not.toHaveBeenCalled();
            expect(result).toEqual([
                expect.objectContaining({
                    title: 'Error',
                    status: expect.stringContaining('verification required'),
                }),
            ]);
        });
    });
});
