import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getChatGPTVisibleImageUrls: vi.fn(),
    clearChatGPTDraft: vi.fn(),
    prepareChatGPTImagePaths: vi.fn(),
    sendChatGPTMessage: vi.fn(),
    uploadChatGPTImages: vi.fn(),
    waitForChatGPTImages: vi.fn(),
    getChatGPTImageAssets: vi.fn(),
    saveBase64ToFile: vi.fn(),
}));

vi.mock('./utils.js', () => ({
    clearChatGPTDraft: mocks.clearChatGPTDraft,
    getChatGPTVisibleImageUrls: mocks.getChatGPTVisibleImageUrls,
    normalizeBooleanFlag: (value, fallback = false) => {
        if (typeof value === 'boolean') return value;
        if (value == null || value === '') return fallback;
        const normalized = String(value).trim().toLowerCase();
        return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
    },
    prepareChatGPTImagePaths: mocks.prepareChatGPTImagePaths,
    sendChatGPTMessage: mocks.sendChatGPTMessage,
    uploadChatGPTImages: mocks.uploadChatGPTImages,
    waitForChatGPTImages: mocks.waitForChatGPTImages,
    getChatGPTImageAssets: mocks.getChatGPTImageAssets,
}));

vi.mock('@jackwener/opencli/utils', () => ({
    saveBase64ToFile: mocks.saveBase64ToFile,
}));

const { imageCommand, nextAvailablePath, parseImagePaths, resolveOutputDir } = await import('./image.js');

function createPage() {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue('https://chatgpt.com/c/test-conversation'),
    };
}

beforeEach(() => {
    vi.restoreAllMocks();
    mocks.clearChatGPTDraft.mockReset().mockResolvedValue(undefined);
    mocks.prepareChatGPTImagePaths.mockReset().mockImplementation(async (paths) => ({ ok: true, paths }));
    mocks.getChatGPTVisibleImageUrls.mockReset().mockResolvedValue([]);
    mocks.sendChatGPTMessage.mockReset().mockResolvedValue(true);
    mocks.uploadChatGPTImages.mockReset().mockResolvedValue({ ok: true });
    mocks.waitForChatGPTImages.mockReset().mockResolvedValue(['https://images.example/generated.png']);
    mocks.getChatGPTImageAssets.mockReset().mockResolvedValue([{
        url: 'https://images.example/generated.png',
        dataUrl: 'data:image/png;base64,aGVsbG8=',
        mimeType: 'image/png',
    }]);
    mocks.saveBase64ToFile.mockReset().mockResolvedValue(undefined);
});

describe('chatgpt image output paths', () => {
    it('expands the default and explicit home-relative output directories', () => {
        expect(resolveOutputDir()).toBe(path.join(os.homedir(), 'Pictures', 'chatgpt'));
        expect(resolveOutputDir('~/tmp/chatgpt-images')).toBe(path.join(os.homedir(), 'tmp', 'chatgpt-images'));
        expect(resolveOutputDir('~')).toBe(os.homedir());
    });

    it('generates a non-overwriting file path when a timestamp collision exists', () => {
        const dir = '/tmp/chatgpt';
        const taken = new Set([
            path.join(dir, 'chatgpt_123.png'),
            path.join(dir, 'chatgpt_123_1.png'),
        ]);

        expect(nextAvailablePath(dir, 'chatgpt_123', '.png', (file) => taken.has(file))).toBe(path.join(dir, 'chatgpt_123_2.png'));
    });

    it('parses comma-separated image paths', () => {
        expect(parseImagePaths('/tmp/a.png, /tmp/b.jpg')).toEqual(['/tmp/a.png', '/tmp/b.jpg']);
        expect(parseImagePaths([' /tmp/a.png ', '/tmp/b.jpg,/tmp/c.webp'])).toEqual(['/tmp/a.png', '/tmp/b.jpg', '/tmp/c.webp']);
    });
});

describe('chatgpt image upload flow', () => {
    it('uploads local images before sending an edit prompt', async () => {
        mocks.prepareChatGPTImagePaths.mockResolvedValue({ ok: true, paths: ['/abs/cat.png', '/abs/dog.jpg'] });
        await imageCommand.func(createPage(), {
            prompt: 'make the background blue',
            image: '/tmp/cat.png,/tmp/dog.jpg',
            op: '',
            sd: true,
            timeout: 240,
        });

        expect(mocks.clearChatGPTDraft).toHaveBeenCalled();
        expect(mocks.uploadChatGPTImages).toHaveBeenCalledWith(expect.anything(), ['/abs/cat.png', '/abs/dog.jpg']);
        expect(mocks.uploadChatGPTImages.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.getChatGPTVisibleImageUrls.mock.invocationCallOrder[0],
        );
        expect(mocks.sendChatGPTMessage).toHaveBeenCalledWith(expect.anything(), 'Edit the attached images: make the background blue');
    });

    it('rejects invalid local image paths before browser navigation', async () => {
        mocks.prepareChatGPTImagePaths.mockResolvedValue({ ok: false, reason: 'Image not found: /tmp/missing.png' });
        const page = createPage();

        await expect(imageCommand.func(page, {
            prompt: 'make the background blue',
            image: '/tmp/missing.png',
            op: '',
            sd: false,
            timeout: 240,
        })).rejects.toMatchObject({
            code: 'ARGUMENT',
            message: expect.stringContaining('Image not found'),
        });
        expect(page.goto).not.toHaveBeenCalled();
        expect(mocks.uploadChatGPTImages).not.toHaveBeenCalled();
    });

    it('surfaces upload failures as command execution errors', async () => {
        mocks.uploadChatGPTImages.mockResolvedValue({ ok: false, reason: 'image upload preview did not appear' });

        await expect(imageCommand.func(createPage(), {
            prompt: 'make the background blue',
            image: '/tmp/cat.png',
            op: '',
            sd: false,
            timeout: 240,
        })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('image upload preview did not appear'),
        });
    });
});

describe('chatgpt image failure contracts', () => {
    it('fails fast when the image prompt cannot be sent', async () => {
        mocks.sendChatGPTMessage.mockResolvedValue(false);

        await expect(imageCommand.func(createPage(), {
            prompt: 'cat',
            op: '',
            sd: false,
            timeout: 240,
        })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('Failed to send image prompt to ChatGPT'),
        });
        expect(mocks.waitForChatGPTImages).not.toHaveBeenCalled();
    });

    it('fails fast when image generation detection finds no new images', async () => {
        mocks.waitForChatGPTImages.mockResolvedValue([]);

        await expect(imageCommand.func(createPage(), {
            prompt: 'cat',
            op: '',
            sd: false,
            timeout: 240,
        })).rejects.toMatchObject({
            code: 'EMPTY_RESULT',
            message: expect.stringContaining('chatgpt image returned no data'),
            hint: expect.stringContaining('No generated images were detected'),
        });
    });

    it('fails fast when generated image assets cannot be exported', async () => {
        mocks.getChatGPTImageAssets.mockResolvedValue([]);

        await expect(imageCommand.func(createPage(), {
            prompt: 'cat',
            op: '',
            sd: false,
            timeout: 240,
        })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('Failed to export generated ChatGPT image assets'),
        });
    });
});
