import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './reel.js';
const tempDirs = [];
function createTempVideo(name = 'demo.mp4', bytes = Buffer.from('video')) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-instagram-reel-'));
    tempDirs.push(dir);
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, bytes);
    return filePath;
}
function createPageMock(evaluateResults, overrides = {}) {
    const evaluate = vi.fn();
    for (const result of evaluateResults) {
        evaluate.mockResolvedValueOnce(result);
    }
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate,
        getCookies: vi.fn().mockResolvedValue([]),
        snapshot: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
        typeText: vi.fn().mockResolvedValue(undefined),
        pressKey: vi.fn().mockResolvedValue(undefined),
        scrollTo: vi.fn().mockResolvedValue(undefined),
        getFormState: vi.fn().mockResolvedValue({ forms: [], orphanFields: [] }),
        wait: vi.fn().mockResolvedValue(undefined),
        tabs: vi.fn().mockResolvedValue([]),
        closeTab: vi.fn().mockResolvedValue(undefined),
        newTab: vi.fn().mockResolvedValue(undefined),
        selectTab: vi.fn().mockResolvedValue(undefined),
        networkRequests: vi.fn().mockResolvedValue([]),
        consoleMessages: vi.fn().mockResolvedValue([]),
        scroll: vi.fn().mockResolvedValue(undefined),
        autoScroll: vi.fn().mockResolvedValue(undefined),
        installInterceptor: vi.fn().mockResolvedValue(undefined),
        getInterceptedRequests: vi.fn().mockResolvedValue([]),
        waitForCapture: vi.fn().mockResolvedValue(undefined),
        screenshot: vi.fn().mockResolvedValue(''),
        setFileInput: vi.fn().mockResolvedValue(undefined),
        insertText: vi.fn().mockResolvedValue(undefined),
        getCurrentUrl: vi.fn().mockResolvedValue(null),
        ...overrides,
    };
}
afterAll(() => {
    for (const dir of tempDirs) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
describe('instagram reel registration', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('rejects missing --video before browser work', async () => {
        const page = createPageMock([]);
        const cmd = getRegistry().get('instagram/reel');
        await expect(cmd.func(page, { content: 'hello reel' })).rejects.toThrow(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });
    it('rejects unsupported video formats', async () => {
        const videoPath = createTempVideo('demo.mov');
        const page = createPageMock([]);
        const cmd = getRegistry().get('instagram/reel');
        await expect(cmd.func(page, { video: videoPath })).rejects.toThrow('Unsupported video format');
        expect(page.goto).not.toHaveBeenCalled();
    });
    it('uploads a reel video without caption and shares it', async () => {
        const videoPath = createTempVideo();
        const page = createPageMock([
            { ok: false }, // dismiss residual dialogs
            { ok: true }, // ensure composer open
            { ok: true }, // composer upload input ready
            { ok: true, selectors: ['[data-opencli-reel-upload-index="0"]', '[data-opencli-reel-upload-index="1"]'] }, // resolve upload selector
            { count: 1 }, // file bound to input
            { state: 'preview', detail: 'Crop Back Next' }, // preview detected
            { ok: true, label: 'OK' }, // dismiss reels nux
            { ok: true, label: 'Next' }, // move from crop to edit
            { state: 'edit' }, // edit stage
            { ok: true, label: 'Next' }, // move from edit to composer
            { state: 'composer' }, // composer stage
            { ok: true, label: 'Share' }, // share
            { ok: true, url: 'https://www.instagram.com/reel/REEL123/' }, // success
        ]);
        const cmd = getRegistry().get('instagram/reel');
        const result = await cmd.func(page, { video: videoPath });
        expect(page.setFileInput).toHaveBeenCalledWith([videoPath], '[data-opencli-reel-upload-index="0"]');
        expect(page.insertText).not.toHaveBeenCalled();
        expect(result).toEqual([
            {
                status: '✅ Posted',
                detail: 'Single reel shared successfully',
                url: 'https://www.instagram.com/reel/REEL123/',
            },
        ]);
    });
    it.each([
        'demo 视频-sign=abc&t=123video.MP4',
        ...(process.platform === 'win32' ? [] : ['demo.mp4?sign=abc&t=123video.MP4']),
    ])('copies unsafe local video filename %s to a safe temp upload path before setFileInput', async (filename) => {
        const sourceBytes = Buffer.from('query-like video');
        const videoPath = createTempVideo(filename, sourceBytes);
        const setFileInput = vi.fn(async ([uploadPath]) => {
            expect(uploadPath).not.toBe(videoPath);
            expect(path.dirname(uploadPath)).toBe(os.tmpdir());
            expect(path.basename(uploadPath)).toMatch(/^opencli-instagram-video-real\.mp4$/i);
            expect(fs.readFileSync(uploadPath)).toEqual(sourceBytes);
        });
        const page = createPageMock([
            { ok: false },
            { ok: true },
            { ok: true },
            { ok: true, selectors: ['[data-opencli-reel-upload-index="0"]'] },
            { count: 1 },
            { state: 'preview', detail: 'Crop Back Next' },
            { ok: true, label: 'OK' },
            { ok: true, label: 'Next' },
            { state: 'edit' },
            { ok: true, label: 'Next' },
            { state: 'composer' },
            { ok: true, label: 'Share' },
            { ok: true, url: 'https://www.instagram.com/reel/REELSAFE123/' },
        ], { setFileInput });
        const cmd = getRegistry().get('instagram/reel');
        await cmd.func(page, { video: videoPath });
        const uploadPaths = page.setFileInput.mock.calls[0]?.[0] ?? [];
        expect(uploadPaths).toHaveLength(1);
        expect(fs.existsSync(uploadPaths[0])).toBe(false);
        expect(fs.existsSync(videoPath)).toBe(true);
    });
    it('uploads a reel video with caption and shares it', async () => {
        const videoPath = createTempVideo('captioned.mp4');
        const page = createPageMock([
            { ok: false }, // dismiss residual dialogs
            { ok: true }, // ensure composer open
            { ok: true }, // composer upload input ready
            { ok: true, selectors: ['[data-opencli-reel-upload-index="0"]'] }, // resolve upload selector
            { count: 1 }, // file bound to input
            { state: 'preview', detail: 'Crop Back Next' }, // preview detected
            { ok: true, label: 'OK' }, // dismiss reels nux
            { ok: true, label: 'Next' }, // move from crop to edit
            { state: 'edit' }, // edit stage
            { ok: true, label: 'Next' }, // move from edit to composer
            { state: 'composer' }, // composer stage
            { ok: true }, // focus caption editor
            { ok: true }, // post-insert event dispatch
            { ok: true }, // caption matches
            { ok: true, label: 'Share' }, // share
            { ok: true, url: 'https://www.instagram.com/reel/REEL456/' }, // success
        ]);
        const cmd = getRegistry().get('instagram/reel');
        const result = await cmd.func(page, { video: videoPath, content: 'hello reel' });
        expect(page.insertText).toHaveBeenCalledWith('hello reel');
        expect(result).toEqual([
            {
                status: '✅ Posted',
                detail: 'Single reel shared successfully',
                url: 'https://www.instagram.com/reel/REEL456/',
            },
        ]);
    });
});
