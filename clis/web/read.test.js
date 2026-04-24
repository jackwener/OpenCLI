import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDownloadArticle } = vi.hoisted(() => ({
    mockDownloadArticle: vi.fn(),
}));

vi.mock('@jackwener/opencli/download/article-download', () => ({
    downloadArticle: mockDownloadArticle,
}));

const { __test__ } = await import('./read.js');

describe('web/read stdout behavior', () => {
    const read = __test__.command;
    const page = {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue({
            title: 'Example Article',
            author: 'Author',
            publishTime: '2026-04-22',
            contentHtml: '<p>hello</p>',
            imageUrls: ['https://example.com/a.jpg'],
        }),
    };

    beforeEach(() => {
        mockDownloadArticle.mockReset();
        mockDownloadArticle.mockResolvedValue([{
            title: 'Example Article',
            author: 'Author',
            publish_time: '2026-04-22',
            status: 'success',
            size: '1 KB',
            saved: '-',
        }]);
        page.goto.mockClear();
        page.wait.mockClear();
        page.evaluate.mockClear();
    });

    it('returns null in --stdout mode so the CLI does not append result rows to stdout', async () => {
        const result = await read.func(page, {
            url: 'https://example.com/article',
            output: '/tmp/out',
            'download-images': false,
            stdout: true,
        });

        expect(result).toBeNull();
        expect(mockDownloadArticle).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'Example Article',
                sourceUrl: 'https://example.com/article',
            }),
            expect.objectContaining({
                output: '/tmp/out',
                stdout: true,
            }),
        );
    });

    it('still returns the saved-row payload when writing to disk', async () => {
        const rows = [{ title: 'Example Article', saved: '/tmp/out/Example Article/example.md' }];
        mockDownloadArticle.mockResolvedValue(rows);

        const result = await read.func(page, {
            url: 'https://example.com/article',
            output: '/tmp/out',
            'download-images': false,
            stdout: false,
        });

        expect(result).toBe(rows);
    });
});
