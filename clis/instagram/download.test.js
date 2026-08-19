import * as os from 'node:os';
import * as path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
const { mockHttpDownload, mockMkdirSync, logSpy } = vi.hoisted(() => ({
    mockHttpDownload: vi.fn(),
    mockMkdirSync: vi.fn(),
    logSpy: vi.spyOn(console, 'log').mockImplementation(() => undefined),
}));
vi.mock('@jackwener/opencli/download', async () => {
    const actual = await vi.importActual('@jackwener/opencli/download');
    return { ...actual, httpDownload: mockHttpDownload };
});
vi.mock('node:fs', () => ({
    mkdirSync: mockMkdirSync,
}));
const { buildInstagramDownloadItems, buildInstagramFetchScript, parseInstagramMediaTarget, resolveOutputDir, shortcodeToMediaId, } = await import('./download.js');
let cmd;
beforeAll(() => {
    cmd = getRegistry().get('instagram/download');
    expect(cmd?.func).toBeTypeOf('function');
});
function createPageMock(evaluateResult) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(evaluateResult),
    };
}
describe('instagram download helpers', () => {
    it('parses canonical and username-prefixed Instagram media URLs', () => {
        expect(parseInstagramMediaTarget('https://www.instagram.com/reel/DWg8NuZEj9p/?utm_source=ig_web_copy_link')).toEqual({
            kind: 'reel',
            shortcode: 'DWg8NuZEj9p',
            canonicalUrl: 'https://www.instagram.com/reel/DWg8NuZEj9p/',
        });
        expect(parseInstagramMediaTarget('https://www.instagram.com/nasa/p/DWUR_azCWbN/?img_index=1')).toEqual({
            kind: 'p',
            shortcode: 'DWUR_azCWbN',
            canonicalUrl: 'https://www.instagram.com/p/DWUR_azCWbN/',
        });
    });
    it('rejects unsupported URLs early', () => {
        expect(() => parseInstagramMediaTarget('https://example.com/p/abc')).toThrow(ArgumentError);
        expect(() => parseInstagramMediaTarget('https://www.instagram.com/stories/abc/123')).toThrow(ArgumentError);
    });
    it('builds padded filenames and preserves known file extensions', () => {
        expect(buildInstagramDownloadItems('DWUR_azCWbN', [
            { type: 'image', url: 'https://cdn.example.com/photo.webp?foo=1' },
            { type: 'video', url: 'https://cdn.example.com/video.mp4?bar=2' },
        ])).toEqual([
            { type: 'image', url: 'https://cdn.example.com/photo.webp?foo=1', filename: 'DWUR_azCWbN_01.webp' },
            { type: 'video', url: 'https://cdn.example.com/video.mp4?bar=2', filename: 'DWUR_azCWbN_02.mp4' },
        ]);
    });
    it('typed-fails malformed download items instead of passing them to the downloader', () => {
        expect(() => buildInstagramDownloadItems('DWUR_azCWbN', [{ type: 'image', url: 'not-a-valid-url' }]))
            .toThrow('invalid download URL');
        expect(() => buildInstagramDownloadItems('DWUR_azCWbN', [{ type: 'image', url: 'file:///tmp/photo.jpg' }]))
            .toThrow('unsupported download URL');
        expect(() => buildInstagramDownloadItems('DWUR_azCWbN', [{ type: 'cover', url: 'https://cdn.example.com/photo.jpg' }]))
            .toThrow('malformed media item');
    });
    it('decodes a shortcode into the media id the info endpoint takes', () => {
        expect(shortcodeToMediaId('DbnndRYRLRm')).toBe('3956304333007795302');
        expect(shortcodeToMediaId('')).toBe('');
        expect(shortcodeToMediaId('not a shortcode')).toBe('');
        expect(shortcodeToMediaId('A')).toBe('');
        expect(shortcodeToMediaId('___________')).toBe('');
    });
    it('requests the media info endpoint instead of a persisted query', () => {
        const script = buildInstagramFetchScript('DbnndRYRLRm');

        expect(script).toContain('/api/v1/media/');
        expect(script).toContain('"3956304333007795302"');
        expect(script).not.toContain('doc_id');
    });
    it('reads media from the info payload, including carousels and videos', async () => {
        const calls = [];
        const read = (payload) => new Function('calls', `return (async () => {
      const fetch = (url, init) => { calls.push([url, init]); return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(${JSON.stringify(JSON.stringify(payload))}) }); };
      return await ${buildInstagramFetchScript('DbnndRYRLRm')};
    })()`)(calls);

        await expect(read({
            items: [
                {
                    code: 'DbnndRYRLRm',
                    media_type: 2,
                    user: { username: 'instagram' },
                    video_versions: [{ url: 'https://cdn.example.com/small.mp4', width: 480 }, { url: 'https://cdn.example.com/full.mp4', width: 1080 }],
                    image_versions2: { candidates: [{ url: 'https://cdn.example.com/cover.jpg', width: 1080 }] },
                },
                { code: 'SecondItem', media_type: 1, image_versions2: { candidates: [{ url: 'https://cdn.example.com/other.jpg', width: 1080 }] } },
            ],
        })).resolves.toEqual({
            ok: true,
            shortcode: 'DbnndRYRLRm',
            owner: 'instagram',
            items: [{ type: 'video', url: 'https://cdn.example.com/full.mp4' }],
        });
        expect(calls[0][0]).toBe('https://www.instagram.com/api/v1/media/3956304333007795302/info/');
        expect(calls[0][1]).toMatchObject({ credentials: 'include', headers: { 'X-IG-App-ID': '936619743392459' } });

        await expect(read({
            items: [{
                code: 'DbnndRYRLRm',
                media_type: 8,
                user: { username: 'instagram' },
                carousel_media: [
                    { media_type: 1, image_versions2: { candidates: [{ url: 'https://cdn.example.com/thumb.jpg', width: 320 }, { url: 'https://cdn.example.com/one.jpg', width: 1080 }] } },
                    { media_type: 2, video_versions: [{ url: 'https://cdn.example.com/two.mp4', width: 1080 }] },
                ],
            }],
        })).resolves.toMatchObject({
            items: [
                { type: 'image', url: 'https://cdn.example.com/one.jpg' },
                { type: 'video', url: 'https://cdn.example.com/two.mp4' },
            ],
        });
    });
    it('typed-fails instead of using a cover image when a video carries no renditions', async () => {
        const read = (payload) => new Function(`return (async () => {
      const fetch = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(${JSON.stringify(JSON.stringify(payload))}) });
      return await ${buildInstagramFetchScript('DbnndRYRLRm')};
    })()`)();

        await expect(read({
            items: [{
                code: 'DbnndRYRLRm',
                media_type: 2,
                video_versions: [],
                image_versions2: { candidates: [{ url: 'https://cdn.example.com/cover.jpg', width: 1080 }] },
            }],
        })).resolves.toMatchObject({ ok: false, errorCode: 'COMMAND_EXEC', error: expect.stringContaining('video renditions') });

        await expect(read({ items: [] })).resolves.toMatchObject({ ok: false, errorCode: 'PRIVATE_OR_UNAVAILABLE' });
    });
    it('typed-fails malformed media info payloads and wrong shortcode identity', async () => {
        const read = (payload) => new Function(`return (async () => {
      const fetch = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(${JSON.stringify(JSON.stringify(payload))}) });
      return await ${buildInstagramFetchScript('DbnndRYRLRm')};
    })()`)();

        await expect(read({ status: 'ok' })).resolves.toMatchObject({ ok: false, errorCode: 'COMMAND_EXEC', error: expect.stringContaining('malformed items') });
        await expect(read({ status: 'fail', message: 'temporary parser drift' })).resolves.toMatchObject({ ok: false, errorCode: 'COMMAND_EXEC' });
        await expect(read({ items: [{ code: 'DifferentCode', media_type: 1, image_versions2: { candidates: [{ url: 'https://cdn.example.com/photo.jpg', width: 1 }] } }] }))
            .resolves.toMatchObject({ ok: false, errorCode: 'COMMAND_EXEC', error: expect.stringContaining('different shortcode') });
        await expect(read({ items: [{ code: 'DbnndRYRLRm', media_type: 8, carousel_media: [] }] }))
            .resolves.toMatchObject({ ok: false, errorCode: 'COMMAND_EXEC', error: expect.stringContaining('carousel metadata returned no media items') });
        await expect(read({ items: [{ code: 'DbnndRYRLRm', media_type: 8, carousel_media: [{ media_type: 1, image_versions2: { candidates: [{ url: 'https://cdn.example.com/one.jpg', width: 1 }] } }, { media_type: 2, video_versions: [] }] }] }))
            .resolves.toMatchObject({ ok: false, errorCode: 'COMMAND_EXEC', error: expect.stringContaining('video renditions') });
    });
    it('normalizes fetch failures into typed command errors', async () => {
        const read = () => new Function(`return (async () => {
      const fetch = () => Promise.reject(new Error('network down'));
      return await ${buildInstagramFetchScript('DbnndRYRLRm')};
    })()`)();

        await expect(read()).resolves.toMatchObject({ ok: false, errorCode: 'COMMAND_EXEC', error: expect.stringContaining('network down') });
    });
    it('treats a status:fail error body as private or unavailable', async () => {
        const read = (payload) => new Function(`return (async () => {
      const fetch = () => Promise.resolve({ ok: false, status: 400, text: () => Promise.resolve(${JSON.stringify(JSON.stringify(payload))}) });
      return await ${buildInstagramFetchScript('DbnndRYRLRm')};
    })()`)();

        await expect(read({ status: 'fail', message: 'Media not found or unavailable' })).resolves.toEqual({ ok: false, errorCode: 'PRIVATE_OR_UNAVAILABLE', error: 'Media not found or unavailable' });
    });
    it('rejects a shortcode that is not in the media id alphabet', () => {
        expect(() => parseInstagramMediaTarget('https://www.instagram.com/p/DWUR%5FazCWbN/')).toThrow(ArgumentError);
        expect(() => parseInstagramMediaTarget('https://www.instagram.com/p/___________/')).toThrow(ArgumentError);
    });
    it('expands a leading ~ in the download path', () => {
        expect(resolveOutputDir('~/Downloads/Instagram')).toBe(path.join(os.homedir(), 'Downloads', 'Instagram'));
        expect(resolveOutputDir('~')).toBe(os.homedir());
        expect(resolveOutputDir('instagram-test')).toBe(path.resolve('instagram-test'));
        expect(resolveOutputDir('')).toBe(path.join(os.homedir(), 'Downloads', 'Instagram'));
    });
});
describe('instagram download command', () => {
    beforeEach(() => {
        mockHttpDownload.mockReset();
        mockMkdirSync.mockClear();
        logSpy.mockClear();
    });
    it('rejects invalid URLs before browser work', async () => {
        const page = createPageMock({ ok: true, items: [] });
        await expect(cmd.func(page, { url: 'https://example.com/not-instagram' })).rejects.toThrow(ArgumentError);
        expect(page.goto.mock.calls).toHaveLength(0);
    });
    it('maps auth failures to AuthRequiredError', async () => {
        const page = createPageMock({ ok: false, errorCode: 'AUTH_REQUIRED', error: 'Instagram login required' });
        await expect(cmd.func(page, { url: 'https://www.instagram.com/p/DWUR_azCWbN/' })).rejects.toThrow(AuthRequiredError);
        expect(mockHttpDownload).not.toHaveBeenCalled();
    });
    it('maps rate limit failures to CliError with RATE_LIMITED code', async () => {
        const page = createPageMock({ ok: false, errorCode: 'RATE_LIMITED', error: 'Please wait a few minutes' });
        await expect(cmd.func(page, { url: 'https://www.instagram.com/p/DWUR_azCWbN/' })).rejects.toMatchObject({ code: 'RATE_LIMITED' });
        expect(mockHttpDownload).not.toHaveBeenCalled();
    });
    it('maps private/unavailable failures to CommandExecutionError', async () => {
        const page = createPageMock({ ok: false, errorCode: 'PRIVATE_OR_UNAVAILABLE', error: 'Post may be private' });
        await expect(cmd.func(page, { url: 'https://www.instagram.com/p/DWUR_azCWbN/' })).rejects.toThrow(CommandExecutionError);
        expect(mockHttpDownload).not.toHaveBeenCalled();
    });
    it('throws when no downloadable media is found', async () => {
        const page = createPageMock({ ok: true, shortcode: 'DWUR_azCWbN', items: [] });
        await expect(cmd.func(page, { url: 'https://www.instagram.com/p/DWUR_azCWbN/' })).rejects.toThrow(CommandExecutionError);
        expect(mockHttpDownload).not.toHaveBeenCalled();
    });
    it('unwraps Browser Bridge envelopes before validating metadata', async () => {
        mockHttpDownload.mockResolvedValueOnce({ success: true, size: 120_000 });
        const page = createPageMock({
            session: 'site:instagram',
            data: {
                ok: true,
                shortcode: 'DWUR_azCWbN',
                items: [{ type: 'image', url: 'https://cdn.example.com/photo.webp?foo=1' }],
            },
        });

        await expect(cmd.func(page, { url: 'https://www.instagram.com/p/DWUR_azCWbN/', path: './instagram-test' })).resolves.toBeNull();
        expect(mockHttpDownload).toHaveBeenCalledTimes(1);
    });
    it('typed-fails malformed Browser Bridge envelopes and zero-byte downloads', async () => {
        await expect(cmd.func(createPageMock({ session: 'site:instagram' }), { url: 'https://www.instagram.com/p/DWUR_azCWbN/' }))
            .rejects.toThrow('malformed result');

        mockHttpDownload.mockResolvedValueOnce({ success: true, size: 0 });
        await expect(cmd.func(createPageMock({
            ok: true,
            shortcode: 'DWUR_azCWbN',
            items: [{ type: 'image', url: 'https://cdn.example.com/photo.webp?foo=1' }],
        }), { url: 'https://www.instagram.com/p/DWUR_azCWbN/' }))
            .rejects.toThrow('Failed to verify downloaded bytes');
    });
    it('downloads media and prints saved directory', async () => {
        mockHttpDownload
            .mockResolvedValueOnce({ success: true, size: 120_000 })
            .mockResolvedValueOnce({ success: true, size: 8_200_000 });
        const page = createPageMock({
            ok: true,
            shortcode: 'DWUR_azCWbN',
            items: [
                { type: 'image', url: 'https://cdn.example.com/photo.webp?foo=1' },
                { type: 'video', url: 'https://cdn.example.com/video.mp4?bar=2' },
            ],
        });
        const result = await cmd.func(page, {
            url: 'https://www.instagram.com/nasa/p/DWUR_azCWbN/?img_index=1',
            path: './instagram-test',
        });
        expect(result).toBeNull();
        expect(page.goto.mock.calls[0]?.[0]).toBe('https://www.instagram.com/p/DWUR_azCWbN/');
        expect(mockHttpDownload).toHaveBeenNthCalledWith(1, 'https://cdn.example.com/photo.webp?foo=1', expect.stringContaining('instagram-test/DWUR_azCWbN/DWUR_azCWbN_01.webp'), expect.objectContaining({ timeout: 60000 }));
        expect(mockHttpDownload).toHaveBeenNthCalledWith(2, 'https://cdn.example.com/video.mp4?bar=2', expect.stringContaining('instagram-test/DWUR_azCWbN/DWUR_azCWbN_02.mp4'), expect.objectContaining({ timeout: 120000 }));
        const savedDir = path.join(path.resolve('instagram-test'), 'DWUR_azCWbN');
        const displayed = savedDir.startsWith(os.homedir()) ? `~${savedDir.slice(os.homedir().length)}` : savedDir;
        expect(logSpy).toHaveBeenCalledWith(`📁 saved: ${displayed}`);
    });
    it('expands the home shorthand the path default carries', async () => {
        mockHttpDownload.mockResolvedValueOnce({ success: true, size: 120_000 });
        const page = createPageMock({
            ok: true,
            shortcode: 'DWUR_azCWbN',
            items: [
                { type: 'image', url: 'https://cdn.example.com/photo.webp?foo=1' },
            ],
        });
        await cmd.func(page, { url: 'https://www.instagram.com/p/DWUR_azCWbN/', path: '~/Downloads/Instagram' });
        expect(mockHttpDownload).toHaveBeenCalledWith('https://cdn.example.com/photo.webp?foo=1', expect.stringContaining(`${os.homedir()}/Downloads/Instagram/DWUR_azCWbN/DWUR_azCWbN_01.webp`), expect.objectContaining({ timeout: 60000 }));
    });
});
