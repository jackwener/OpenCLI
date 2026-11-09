import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import {
    BASE64_FALLBACK_MAX_BYTES,
    sniffMime,
    uploadFiles,
    validateMediaFile,
    waitForVideoReady,
} from './publish-helpers.js';
import './publish-video.js';

function writeMedia(name, bytes) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-xhs-video-'));
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, Buffer.from(bytes));
    return filePath;
}

const MP4_BYTES = [
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, // ....ftypisom
    0x00, 0x00, 0x02, 0x00, 0x66, 0x72, 0x65, 0x65, 0x6d, 0x70, 0x34, 0x31,
    0x00, 0x00, 0x02, 0x09, 0x6d, 0x64, 0x61, 0x74,
];
const QUICKTIME_BYTES = [
    0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20, // ....ftypqt
    0x00, 0x00, 0x02, 0x00, 0x71, 0x74, 0x20, 0x20,
];
const JPG_BYTES = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46];

function createVideoPage(conditional, overrides = {}) {
    const evaluate = vi.fn(async (js) => conditional(String(js)));
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate,
        setFileInput: vi.fn().mockResolvedValue(undefined),
        insertText: vi.fn().mockResolvedValue(undefined),
        pressKey: vi.fn().mockResolvedValue(undefined),
        screenshot: vi.fn().mockResolvedValue(''),
        ...overrides,
    };
}

/** Evaluate-responder for a full happy-path publish run. */
function happyPathResponder({ topicChipsAfter = ['梦核'], finalUrl = 'https://creator.xiaohongshu.com/publish/success' } = {}) {
    let topicReadCount = 0;
    return (code) => {
        if (code.includes('data-opencli-video-input')) {
            return 'input[data-opencli-video-input="1"]';
        }
        if (code.includes('上传中') || code.includes('转码中')) {
            return { hasForm: true, uploading: false, done: true, failed: false };
        }
        if (code.includes('__opencli_xhs_fill_phase = "locate"')) {
            return { ok: true, sel: 'input[x]', kind: 'input' };
        }
        if (code.includes('__opencli_xhs_fill_phase = "apply"')) {
            return { ok: true, actual: 'filled' };
        }
        if (code.includes("execCommand('delete')")) return true;
        if (code.includes('tiptap-topic')) {
            topicReadCount += 1;
            // Odd reads: pre-state (no chip). Even reads: the wrong chip the
            // suggestion produced. Post-delete reads are odd again.
            return topicReadCount % 2 === 0 ? topicChipsAfter : [];
        }
        if (code.includes('selectNodeContents')) return true;
        if (code.includes('xhs-publish-btn')) return { ok: true, via: 'method', name: '_onPublish' };
        if (code.includes('__opencli_xhs_click_label')) return { ok: true, text: 'clicked' };
        if (code.includes('data-opencli-cover')) return 'input[data-opencli-cover="1"]';
        if (code.includes('location.href')) return finalUrl;
        if (code.includes('发布成功')) return '发布成功';
        return undefined;
    };
}


/** Evaluate-responder that also answers the cover and declaration helpers. */
function coverAndDeclarationResponder() {
    const base = happyPathResponder({ finalUrl: 'https://creator.xiaohongshu.com/publish/success' });
    return (code) => {
        if (code.includes('data-opencli-cover-input')) return 'input[data-opencli-cover-input="1"]';
        if (code.includes('cover-edit-entry')) return true;
        if (code.includes('.d-button')) return true;
        if (code.includes('getComputedStyle')) return true;
        if (code.includes('添加内容类型声明')) return true;
        if (code.includes('.d-option')) return true;
        if (code.includes('host.innerText')) return true;
        return base(code);
    };
}

describe('xiaohongshu publish-video', () => {
    let videoPath;
    beforeEach(() => {
        videoPath = writeMedia('demo.mp4', MP4_BYTES);
    });

    it('registers the command', () => {
        const cmd = getRegistry().get('xiaohongshu/publish-video');
        expect(cmd?.func).toBeTypeOf('function');
    });

    it('rejects a video whose bytes are not mp4/quicktime before navigating', async () => {
        const fake = writeMedia('renamed.mp4', Buffer.from('plain text, not a video').length ? Array.from(Buffer.from('plain text, not a video at all')) : []);
        const cmd = getRegistry().get('xiaohongshu/publish-video');
        const page = createVideoPage(() => undefined);
        await expect(cmd.func(page, { content: '正文', title: '标题', video: fake }))
            .rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });



    it('fails closed when the transcode wait times out', async () => {
        const page = createVideoPage(() => ({ hasForm: false, uploading: true, done: false, failed: false }));
        await expect(waitForVideoReady(page, { timeoutMs: 50, pollSeconds: 0.01 }))
            .rejects.toThrow(/did not finish within 0s.*Nothing was published/is);
    });

    it('fails closed when the site reports a transcode failure', async () => {
        const page = createVideoPage(() => ({ hasForm: false, uploading: false, done: false, failed: true }));
        await expect(waitForVideoReady(page, { timeoutMs: 5_000, pollSeconds: 0.01 }))
            .rejects.toThrow(/upload\/transcode failure/i);
    });

    it('fails closed when a requested topic never matches exactly', async () => {
        const cmd = getRegistry().get('xiaohongshu/publish-video');
        const responder = happyPathResponder({ topicChipsAfter: ['无关话题'] });
        const page = createVideoPage(responder);
        await expect(cmd.func(page, { content: '正文', title: '标题', video: videoPath, topics: '梦核' }))
            .rejects.toThrow(/exact name match/i);
    });

    it('fails closed when success cannot be verified after the click', async () => {
        const cmd = getRegistry().get('xiaohongshu/publish-video');
        const responder = happyPathResponder({ finalUrl: 'https://creator.xiaohongshu.com/publish/publish?target=video' });
        responder.toString();
        const page = createVideoPage((code) => {
            if (code.includes('发布成功')) return '';
            return responder(code);
        });
        await expect(cmd.func(page, { content: '正文', title: '标题', video: videoPath }))
            .rejects.toThrow(/could not be verified/i);
    });

    it('treats a post-submit bounce to login as failure, not success', async () => {
        const cmd = getRegistry().get('xiaohongshu/publish-video');
        const responder = happyPathResponder({ finalUrl: 'https://creator.xiaohongshu.com/login?redirect=/publish' });
        const page = createVideoPage((code) => {
            if (code.includes('发布成功')) return '';
            return responder(code);
        });
        await expect(cmd.func(page, { content: '正文', title: '标题', video: videoPath }))
            .rejects.toThrow(/could not be verified/i);
    });

    it('publishes end to end on the happy path with topics', async () => {
        const cmd = getRegistry().get('xiaohongshu/publish-video');
        const page = createVideoPage(happyPathResponder());
        const rows = await cmd.func(page, { content: '正文', title: '标题', video: videoPath, topics: '梦核' });
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toContain('发布成功');
        expect(rows[0].detail).toContain('话题: 梦核');
        expect(page.setFileInput).toHaveBeenCalledWith([videoPath], 'input[data-opencli-video-input="1"]');
        expect(page.goto).toHaveBeenCalledWith('https://creator.xiaohongshu.com/publish/publish?from=menu_left&target=video');
    });

    it('rejects a cover that is not png/jpeg before navigating', async () => {
        const cmd = getRegistry().get('xiaohongshu/publish-video');
        const page = createVideoPage(() => undefined);
        const fakeCover = writeMedia('cover.txt', Array.from(Buffer.from('not an image')));
        await expect(cmd.func(page, { content: '正文', title: '标题', video: videoPath, cover: fakeCover }))
            .rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('rejects an unsupported declaration value before navigating', async () => {
        const cmd = getRegistry().get('xiaohongshu/publish-video');
        const page = createVideoPage(() => undefined);
        await expect(cmd.func(page, { content: '正文', title: '标题', video: videoPath, declaration: 'ad' }))
            .rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('applies a custom cover and the AI declaration end to end', async () => {
        const cmd = getRegistry().get('xiaohongshu/publish-video');
        const coverPath = writeMedia('cover.jpg', JPG_BYTES);
        const page = createVideoPage(coverAndDeclarationResponder());
        const rows = await cmd.func(page, {
            content: '正文',
            title: '标题',
            video: videoPath,
            cover: coverPath,
            declaration: 'ai',
        });
        expect(rows[0].detail).toContain('封面:cover.jpg');
        expect(rows[0].detail).toContain('声明:ai');
        expect(page.setFileInput).toHaveBeenCalledWith([coverPath], 'input[data-opencli-cover-input="1"]');
    });

    it('fails closed when the cover editor cannot be opened', async () => {
        const cmd = getRegistry().get('xiaohongshu/publish-video');
        const coverPath = writeMedia('cover.jpg', JPG_BYTES);
        const responder = coverAndDeclarationResponder();
        const page = createVideoPage((code) => {
            if (code.includes('cover-edit-entry')) return false;
            return responder(code);
        });
        await expect(cmd.func(page, { content: '正文', title: '标题', video: videoPath, cover: coverPath }))
            .rejects.toThrow(/Cover editor entry/i);
    });

    it('fails closed when the declaration option is missing', async () => {
        const cmd = getRegistry().get('xiaohongshu/publish-video');
        const responder = coverAndDeclarationResponder();
        const page = createVideoPage((code) => {
            if (code.includes('host.innerText')) return true;
            if (code.includes('添加内容类型声明')) return true;
            if (code.includes('.d-option')) return false;
            return responder(code);
        });
        await expect(cmd.func(page, { content: '正文', title: '标题', video: videoPath, declaration: 'ai' }))
            .rejects.toThrow(/Declaration option/i);
    });
});

describe('publish-helpers sniffMime / validateMediaFile / uploadFiles', () => {
    it('sniffs mp4, quicktime, jpeg and png from file bytes', () => {
        expect(sniffMime(writeMedia('a.mp4', MP4_BYTES))).toBe('video/mp4');
        expect(sniffMime(writeMedia('b.mov', QUICKTIME_BYTES))).toBe('video/quicktime');
        expect(sniffMime(writeMedia('c.jpg', JPG_BYTES))).toBe('image/jpeg');
        const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
        expect(sniffMime(writeMedia('d.png', png))).toBe('image/png');
        expect(sniffMime(writeMedia('e.bin', [1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
    });

    it('validateMediaFile checks existence, type and size', () => {
        const filePath = writeMedia('ok.mp4', MP4_BYTES);
        expect(validateMediaFile(filePath, { accepted: ['video/mp4'], maxBytes: 1024, label: 'Video' }).mime).toBe('video/mp4');
        expect(() => validateMediaFile('/nonexistent/x.mp4', { accepted: ['video/mp4'], label: 'Video' })).toThrow(ArgumentError);
        expect(() => validateMediaFile(writeMedia('x.mp4', [1, 2, 3]), { accepted: ['video/mp4'], label: 'Video' })).toThrow(/not a supported file type/i);
        expect(() => validateMediaFile(filePath, { accepted: ['video/mp4'], maxBytes: 4, label: 'Video' })).toThrow(ArgumentError);
    });

    it('uploadFiles prefers setFileInput and falls back to in-page DataTransfer', async () => {
        const filePath = writeMedia('f.mp4', MP4_BYTES);
        const okPage = { setFileInput: vi.fn().mockResolvedValue(undefined) };
        expect(await uploadFiles(okPage, [filePath], 'input[x]')).toMatchObject({ ok: true, via: 'setFileInput' });

        const blocked = okPage.setFileInput.mockRejectedValue(new Error('Unknown action: set-file-input'));
        const fallbackPage = {
            setFileInput: vi.fn(() => { throw new Error('set before assignment'); }),
        };
        fallbackPage.setFileInput = vi.fn().mockImplementation(() => Promise.reject(new Error('Unknown action: set-file-input')));
        void blocked;
        fallbackPage.evaluate = vi.fn().mockResolvedValue({ ok: true, count: 1, via: 'dataTransfer' });
        expect(await uploadFiles(fallbackPage, [filePath], 'input[x]')).toMatchObject({ ok: true, count: 1 });
        expect(fallbackPage.evaluate).toHaveBeenCalled();

        const hardFail = { setFileInput: vi.fn().mockRejectedValue(new Error('Chrome rejected the debugger')) };
        expect(await uploadFiles(hardFail, [filePath], 'input[x]')).toMatchObject({ ok: false });
    });

    it('documents a bounded base64 fallback ceiling', () => {
        expect(BASE64_FALLBACK_MAX_BYTES).toBeLessThanOrEqual(64 * 1024 * 1024);
    });
});
