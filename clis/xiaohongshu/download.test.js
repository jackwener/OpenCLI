import { beforeEach, describe, expect, it, vi } from 'vitest';
const { mockDownloadMedia, mockFormatCookieHeader } = vi.hoisted(() => ({
    mockDownloadMedia: vi.fn(),
    mockFormatCookieHeader: vi.fn(() => 'a=b'),
}));
vi.mock('@jackwener/opencli/download/media-download', () => ({
    downloadMedia: mockDownloadMedia,
}));
vi.mock('@jackwener/opencli/download', () => ({
    formatCookieHeader: mockFormatCookieHeader,
}));
import { getRegistry } from '@jackwener/opencli/registry';
import './download.js';
function createPageMock(evaluateResult) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(evaluateResult),
        snapshot: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
        typeText: vi.fn().mockResolvedValue(undefined),
        pressKey: vi.fn().mockResolvedValue(undefined),
        scrollTo: vi.fn().mockResolvedValue(undefined),
        getFormState: vi.fn().mockResolvedValue({ forms: [], orphanFields: [] }),
        wait: vi.fn().mockResolvedValue(undefined),
        tabs: vi.fn().mockResolvedValue([]),
        selectTab: vi.fn().mockResolvedValue(undefined),
        networkRequests: vi.fn().mockResolvedValue([]),
        consoleMessages: vi.fn().mockResolvedValue([]),
        scroll: vi.fn().mockResolvedValue(undefined),
        autoScroll: vi.fn().mockResolvedValue(undefined),
        installInterceptor: vi.fn().mockResolvedValue(undefined),
        getInterceptedRequests: vi.fn().mockResolvedValue([]),
        getCookies: vi.fn().mockResolvedValue([{ name: 'sid', value: 'secret', domain: '.xiaohongshu.com' }]),
        screenshot: vi.fn().mockResolvedValue(''),
        waitForCapture: vi.fn().mockResolvedValue(undefined),
    };
}
describe('xiaohongshu download', () => {
    const command = getRegistry().get('xiaohongshu/download');
    beforeEach(() => {
        mockDownloadMedia.mockReset();
        mockFormatCookieHeader.mockClear();
        mockDownloadMedia.mockResolvedValue([{ index: 1, type: 'video', status: 'success', size: '1 MB' }]);
    });
    it('preserves short links for navigation but uses canonical note id for output naming', async () => {
        const page = createPageMock({
            noteId: '69bc166f000000001a02069a',
            media: [{ type: 'video', url: 'https://sns-video-hw.xhscdn.com/example.mp4' }],
        });
        const shortUrl = 'http://xhslink.com/o/4MKEjsZnhCz';
        await command.func(page, { 'note-id': shortUrl, output: './out' });
        expect(page.goto.mock.calls[0][0]).toBe(shortUrl);
        expect(mockDownloadMedia).toHaveBeenCalledWith([{ type: 'video', url: 'https://sns-video-hw.xhscdn.com/example.mp4' }], expect.objectContaining({
            output: './out',
            subdir: '69bc166f000000001a02069a',
            filenamePrefix: '69bc166f000000001a02069a',
            cookies: 'a=b',
        }));
    });
    it('preserves full note URL with xsec_token for navigation', async () => {
        const page = createPageMock({
            noteId: '69bc166f000000001a02069a',
            media: [{ type: 'image', url: 'https://ci.xiaohongshu.com/example.jpg' }],
        });
        const fullUrl = 'https://www.xiaohongshu.com/explore/69bc166f000000001a02069a?xsec_token=abc&xsec_source=pc_search';
        await command.func(page, { 'note-id': fullUrl, output: './out' });
        expect(page.goto.mock.calls[0][0]).toBe(fullUrl);
        expect(mockDownloadMedia).toHaveBeenCalledWith([{ type: 'image', url: 'https://ci.xiaohongshu.com/example.jpg' }], expect.objectContaining({
            subdir: '69bc166f000000001a02069a',
            filenamePrefix: '69bc166f000000001a02069a',
        }));
    });
    it('throws SECURITY_BLOCK with bare-id guidance before starting downloads', async () => {
        const page = createPageMock({
            pageUrl: 'https://www.xiaohongshu.com/website-login/error?error_code=300017',
            securityBlock: true,
            noteId: '69bc166f000000001a02069a',
            media: [],
        });
        await expect(command.func(page, { 'note-id': '69bc166f000000001a02069a', output: './out' })).rejects.toMatchObject({
            code: 'SECURITY_BLOCK',
            hint: expect.stringContaining('xsec_token'),
        });
        expect(mockDownloadMedia).not.toHaveBeenCalled();
        expect(page.wait).toHaveBeenCalledWith(expect.objectContaining({ time: expect.any(Number) }));
    });
    it('throws SECURITY_BLOCK with retry guidance for blocked full URLs', async () => {
        const page = createPageMock({
            pageUrl: 'https://www.xiaohongshu.com/website-login/error?error_code=300031',
            securityBlock: true,
            noteId: '69bc166f000000001a02069a',
            media: [],
        });
        await expect(command.func(page, {
            'note-id': 'https://www.xiaohongshu.com/explore/69bc166f000000001a02069a?xsec_token=abc&xsec_source=pc_search',
            output: './out',
        })).rejects.toMatchObject({
            code: 'SECURITY_BLOCK',
            hint: expect.stringContaining('Try again later'),
        });
        expect(mockDownloadMedia).not.toHaveBeenCalled();
    });
});
