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
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { JSDOM } from 'jsdom';
import './download.js';
import { buildDownloadExtractJs } from './download.js';
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
    it('uses canonical note id for signed user profile note URLs', async () => {
        const page = createPageMock({
            noteId: '',
            media: [{ type: 'image', url: 'https://ci.xiaohongshu.com/example.jpg' }],
        });
        const fullUrl = 'https://www.xiaohongshu.com/user/profile/user123/69bc166f000000001a02069a?xsec_token=abc&xsec_source=pc_user';
        await command.func(page, { 'note-id': fullUrl, output: './out' });
        expect(page.goto.mock.calls[0][0]).toBe(fullUrl);
        expect(mockDownloadMedia).toHaveBeenCalledWith([{ type: 'image', url: 'https://ci.xiaohongshu.com/example.jpg' }], expect.objectContaining({
            subdir: '69bc166f000000001a02069a',
            filenamePrefix: '69bc166f000000001a02069a',
        }));
    });
    it('rejects bare note IDs before browser navigation', async () => {
        const page = createPageMock({
            noteId: '69bc166f000000001a02069a',
            media: [],
        });
        await expect(command.func(page, { 'note-id': '69bc166f000000001a02069a', output: './out' })).rejects.toMatchObject({
            code: 'ARGUMENT',
            message: expect.stringContaining('signed URL'),
            hint: expect.stringContaining('xsec_token'),
        });
        expect(page.goto).not.toHaveBeenCalled();
        expect(mockDownloadMedia).not.toHaveBeenCalled();
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
    it('throws EmptyResultError when extraction returns an explicit empty media array', async () => {
        const page = createPageMock({
            noteId: '69bc166f000000001a02069a',
            media: [],
        });
        await expect(command.func(page, {
            'note-id': 'https://www.xiaohongshu.com/explore/69bc166f000000001a02069a?xsec_token=abc',
            output: './out',
        })).rejects.toBeInstanceOf(EmptyResultError);
        expect(mockDownloadMedia).not.toHaveBeenCalled();
    });
    it('throws CommandExecutionError when extraction media shape is malformed', async () => {
        const page = createPageMock({
            noteId: '69bc166f000000001a02069a',
            media: { url: 'https://ci.xiaohongshu.com/example.jpg' },
        });
        await expect(command.func(page, {
            'note-id': 'https://www.xiaohongshu.com/explore/69bc166f000000001a02069a?xsec_token=abc',
            output: './out',
        })).rejects.toBeInstanceOf(CommandExecutionError);
        expect(mockDownloadMedia).not.toHaveBeenCalled();
    });
});

describe('xiaohongshu download buildDownloadExtractJs carousel ordering (JSDOM)', () => {
    function runExtract({ html = '', initialState = null, url = 'https://www.xiaohongshu.com/explore/69f9716c000000003601f90e' } = {}) {
        const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url, runScripts: 'outside-only' });
        if (initialState) {
            dom.window.__INITIAL_STATE__ = initialState;
        }
        const js = buildDownloadExtractJs('69f9716c000000003601f90e');
        return dom.window.eval(js);
    }

    it('preserves carousel order from __INITIAL_STATE__ imageList over DOM discovery order', () => {
        const initialState = {
            note: {
                noteDetailMap: {
                    '69f9716c000000003601f90e': {
                        note: {
                            imageList: [
                                { urlDefault: 'https://sns-img-bd.xhscdn.com/canonical-cover.jpg' },
                                { urlDefault: 'https://sns-img-bd.xhscdn.com/canonical-second.jpg' },
                                { urlDefault: 'https://sns-img-bd.xhscdn.com/canonical-third.jpg' },
                            ],
                        },
                    },
                },
            },
        };
        // DOM has the same images but in a DIFFERENT order: repro for #1514.
        const html = `
          <div class="swiper-slide"><img src="https://sns-img-bd.xhscdn.com/canonical-second.jpg" /></div>
          <div class="swiper-slide"><img src="https://sns-img-bd.xhscdn.com/canonical-cover.jpg" /></div>
          <div class="swiper-slide"><img src="https://sns-img-bd.xhscdn.com/canonical-third.jpg" /></div>
        `;
        const result = runExtract({ html, initialState });
        const images = result.media.filter((m) => m.type === 'image');
        expect(images.map((m) => m.url)).toEqual([
            'https://sns-img-bd.xhscdn.com/canonical-cover.jpg',
            'https://sns-img-bd.xhscdn.com/canonical-second.jpg',
            'https://sns-img-bd.xhscdn.com/canonical-third.jpg',
        ]);
    });

    it('prefers urlDefault but falls back to urlPre / url / infoList.WB_DFT / infoList[0]', () => {
        const initialState = {
            note: {
                noteDetailMap: {
                    '69f9716c000000003601f90e': {
                        note: {
                            imageList: [
                                { urlDefault: 'https://sns-img-bd.xhscdn.com/a.jpg' },
                                { urlPre: 'https://sns-img-bd.xhscdn.com/b.jpg' },
                                { url: 'https://sns-img-bd.xhscdn.com/c.jpg' },
                                { infoList: [{ imageScene: 'WB_PRV', url: 'https://sns-img-bd.xhscdn.com/d-low.jpg' }, { imageScene: 'WB_DFT', url: 'https://sns-img-bd.xhscdn.com/d.jpg' }] },
                                { infoList: [{ url: 'https://sns-img-bd.xhscdn.com/e.jpg' }] },
                            ],
                        },
                    },
                },
            },
        };
        const result = runExtract({ initialState });
        const urls = result.media.filter((m) => m.type === 'image').map((m) => m.url);
        expect(urls).toEqual([
            'https://sns-img-bd.xhscdn.com/a.jpg',
            'https://sns-img-bd.xhscdn.com/b.jpg',
            'https://sns-img-bd.xhscdn.com/c.jpg',
            'https://sns-img-bd.xhscdn.com/d.jpg',
            'https://sns-img-bd.xhscdn.com/e.jpg',
        ]);
    });

    it('strips imageView resize params + query strings from canonical urls', () => {
        const initialState = {
            note: {
                noteDetailMap: {
                    '69f9716c000000003601f90e': {
                        note: {
                            imageList: [
                                { urlDefault: 'https://sns-img-bd.xhscdn.com/raw/imageView2/2/w/1080/cover.jpg?expires=123' },
                            ],
                        },
                    },
                },
            },
        };
        const result = runExtract({ initialState });
        const urls = result.media.filter((m) => m.type === 'image').map((m) => m.url);
        expect(urls).toEqual(['https://sns-img-bd.xhscdn.com/raw/cover.jpg']);
    });

    it('falls back to DOM extraction when __INITIAL_STATE__ omits imageList', () => {
        const html = `
          <div class="swiper-slide"><img src="https://sns-img-bd.xhscdn.com/dom-1.jpg" /></div>
          <div class="swiper-slide"><img src="https://sns-img-bd.xhscdn.com/dom-2.jpg" /></div>
        `;
        const result = runExtract({ html });
        const urls = result.media.filter((m) => m.type === 'image').map((m) => m.url);
        expect(urls).toEqual([
            'https://sns-img-bd.xhscdn.com/dom-1.jpg',
            'https://sns-img-bd.xhscdn.com/dom-2.jpg',
        ]);
    });

    it('skips non-xhscdn / non-xiaohongshu / non-rednote urls in initial state', () => {
        const initialState = {
            note: {
                noteDetailMap: {
                    '69f9716c000000003601f90e': {
                        note: {
                            imageList: [
                                { urlDefault: 'https://sns-img-bd.xhscdn.com/keep.jpg' },
                                { urlDefault: 'https://imgur.com/drop.jpg' },
                                { urlDefault: '' },
                            ],
                        },
                    },
                },
            },
        };
        const result = runExtract({ initialState });
        const urls = result.media.filter((m) => m.type === 'image').map((m) => m.url);
        expect(urls).toEqual(['https://sns-img-bd.xhscdn.com/keep.jpg']);
    });

    it('does not run DOM fallback when initial state yielded any image (preserves canonical order)', () => {
        const initialState = {
            note: {
                noteDetailMap: {
                    '69f9716c000000003601f90e': {
                        note: {
                            imageList: [
                                { urlDefault: 'https://sns-img-bd.xhscdn.com/canonical-only.jpg' },
                            ],
                        },
                    },
                },
            },
        };
        const html = `
          <div class="swiper-slide"><img src="https://sns-img-bd.xhscdn.com/dom-extra.jpg" /></div>
        `;
        const result = runExtract({ html, initialState });
        const urls = result.media.filter((m) => m.type === 'image').map((m) => m.url);
        expect(urls).toEqual(['https://sns-img-bd.xhscdn.com/canonical-only.jpg']);
    });

    it('uses only the current note entry from multi-note initial state maps', () => {
        const initialState = {
            note: {
                noteDetailMap: {
                    othernote0000000000000001: {
                        note: {
                            imageList: [{ urlDefault: 'https://sns-img-bd.xhscdn.com/other.jpg' }],
                            video: { url: 'https://sns-video-bd.xhscdn.com/other.mp4' },
                        },
                    },
                    '69f9716c000000003601f90e': {
                        note: {
                            imageList: [
                                { urlDefault: 'https://sns-img-bd.xhscdn.com/current-1.jpg' },
                                { urlDefault: 'https://sns-img-bd.xhscdn.com/current-2.jpg' },
                            ],
                            video: { url: 'https://sns-video-bd.xhscdn.com/current.mp4' },
                        },
                    },
                },
            },
        };
        const result = runExtract({ initialState });
        const images = result.media.filter((m) => m.type === 'image').map((m) => m.url);
        const videos = result.media.filter((m) => m.type === 'video').map((m) => m.url);
        expect(images).toEqual([
            'https://sns-img-bd.xhscdn.com/current-1.jpg',
            'https://sns-img-bd.xhscdn.com/current-2.jpg',
        ]);
        expect(videos).toEqual(['https://sns-video-bd.xhscdn.com/current.mp4']);
    });

    it('still resolves videos from __INITIAL_STATE__ alongside the image fix', () => {
        const initialState = {
            note: {
                noteDetailMap: {
                    '69f9716c000000003601f90e': {
                        note: {
                            imageList: [{ urlDefault: 'https://sns-img-bd.xhscdn.com/cover.jpg' }],
                            video: { url: 'https://sns-video-bd.xhscdn.com/test.mp4' },
                        },
                    },
                },
            },
        };
        const result = runExtract({ initialState });
        const images = result.media.filter((m) => m.type === 'image').map((m) => m.url);
        const videos = result.media.filter((m) => m.type === 'video').map((m) => m.url);
        expect(images).toEqual(['https://sns-img-bd.xhscdn.com/cover.jpg']);
        expect(videos).toEqual(['https://sns-video-bd.xhscdn.com/test.mp4']);
        expect(result.media.map((m) => m.type)).toEqual(['video', 'image']);
    });
});
