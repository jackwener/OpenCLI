import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDownloadMedia, mockFormatCookieHeader, mockGetConversationAssets } = vi.hoisted(() => ({
    mockDownloadMedia: vi.fn(),
    mockFormatCookieHeader: vi.fn(() => 'sid=secret'),
    mockGetConversationAssets: vi.fn(),
}));

vi.mock('@jackwener/opencli/download/media-download', () => ({
    downloadMedia: mockDownloadMedia,
}));

vi.mock('@jackwener/opencli/download', () => ({
    formatCookieHeader: mockFormatCookieHeader,
}));

vi.mock('./utils.js', async () => {
    const actual = await vi.importActual('./utils.js');
    return {
        ...actual,
        getConversationAssets: mockGetConversationAssets,
    };
});

import { getRegistry } from '@jackwener/opencli/registry';
import './download.js';

function createPageMock() {
    return {
        getCookies: vi.fn().mockResolvedValue([{ name: 'sid', value: 'secret', domain: '.doubao.com' }]),
    };
}

describe('doubao download', () => {
    const download = getRegistry().get('doubao/download');

    beforeEach(() => {
        mockDownloadMedia.mockReset();
        mockFormatCookieHeader.mockClear();
        mockGetConversationAssets.mockReset();
        mockDownloadMedia.mockResolvedValue([{ index: 1, type: 'image', status: 'success', size: '2 MB' }]);
    });

    it('extracts media for a conversation URL and downloads into a conversation subdirectory', async () => {
        const page = createPageMock();
        mockGetConversationAssets.mockResolvedValue([
            {
                type: 'image',
                url: 'https://p3-flow-imagex-sign.byteimg.com/tos-cn/example.jpeg?x-signature=abc',
                key: 'tos-cn/example.jpeg',
                format: 'jpeg',
            },
        ]);
        await download.func(page, {
            id: 'https://www.doubao.com/chat/1234567890123',
            output: './out',
        });
        expect(mockGetConversationAssets).toHaveBeenCalledWith(page, '1234567890123', { variant: 'original' });
        expect(page.getCookies).toHaveBeenCalledWith({ domain: 'doubao.com' });
        expect(mockDownloadMedia).toHaveBeenCalledWith([
            {
                type: 'image',
                url: 'https://p3-flow-imagex-sign.byteimg.com/tos-cn/example.jpeg?x-signature=abc',
                filename: '001_example.jpg',
            },
        ], expect.objectContaining({
            output: './out',
            subdir: '1234567890123',
            cookies: 'sid=secret',
            filenamePrefix: '1234567890123',
            timeout: 15000,
        }));
    });

    it('supports limiting the number of downloaded media items', async () => {
        const page = createPageMock();
        mockGetConversationAssets.mockResolvedValue([
            { type: 'image', url: 'https://example.com/1.png', key: 'one.png' },
            { type: 'image', url: 'https://example.com/2.png', key: 'two.png' },
        ]);
        await download.func(page, { id: '1234567890123', output: './out', limit: '1', timeout: '5000' });
        expect(mockDownloadMedia).toHaveBeenCalledWith([
            expect.objectContaining({ url: 'https://example.com/1.png' }),
        ], expect.objectContaining({
            timeout: 5000,
        }));
    });

    it('returns an explicit failed row when no media is present', async () => {
        const page = createPageMock();
        mockGetConversationAssets.mockResolvedValue([]);
        await expect(download.func(page, { id: '1234567890123' })).resolves.toEqual([
            { index: 0, type: '-', status: 'failed', size: 'No media found' },
        ]);
        expect(mockDownloadMedia).not.toHaveBeenCalled();
    });

    it('rejects unsupported image variants before browser work', async () => {
        const page = createPageMock();
        await expect(download.func(page, { id: '1234567890123', variant: 'large' })).rejects.toMatchObject({
            code: 'ARGUMENT',
            message: expect.stringContaining('Invalid Doubao image variant'),
        });
        expect(mockGetConversationAssets).not.toHaveBeenCalled();
    });

    it('rejects invalid limit and timeout values before browser work', async () => {
        const page = createPageMock();
        await expect(download.func(page, { id: '1234567890123', limit: '-1' })).rejects.toMatchObject({
            code: 'ARGUMENT',
        });
        await expect(download.func(page, { id: '1234567890123', timeout: '-1' })).rejects.toMatchObject({
            code: 'ARGUMENT',
        });
        expect(mockGetConversationAssets).not.toHaveBeenCalled();
    });
});
