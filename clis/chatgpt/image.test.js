import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';

const mocks = vi.hoisted(() => ({
    getChatGPTVisibleImageUrls: vi.fn(),
    clearChatGPTDraft: vi.fn(),
    prepareChatGPTImagePaths: vi.fn(),
    sendChatGPTMessage: vi.fn(),
    uploadChatGPTImages: vi.fn(),
    waitForChatGPTImages: vi.fn(),
    getChatGPTImageAssets: vi.fn(),
    saveBase64ToFile: vi.fn(),
    activateChatGPTImageTool: vi.fn(),
    setChatGPTImageAspect: vi.fn(),
}));

const ASPECT_ALIASES = new Map([
    ['auto', 'Auto'],
    ['1:1', 'Square 1:1'],
    ['square', 'Square 1:1'],
    ['3:4', 'Portrait 3:4'],
    ['portrait', 'Portrait 3:4'],
    ['9:16', 'Story 9:16'],
    ['story', 'Story 9:16'],
    ['4:3', 'Landscape 4:3'],
    ['landscape', 'Landscape 4:3'],
    ['16:9', 'Widescreen 16:9'],
    ['widescreen', 'Widescreen 16:9'],
]);

vi.mock('./utils.js', () => ({
    clearChatGPTDraft: mocks.clearChatGPTDraft,
    getChatGPTVisibleImageUrls: mocks.getChatGPTVisibleImageUrls,
    normalizeBooleanFlag: (value, fallback = false) => {
        if (typeof value === 'boolean') return value;
        if (value == null || value === '') return fallback;
        const normalized = String(value).trim().toLowerCase();
        return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
    },
    parseChatGPTConversationId: (value) => {
        const raw = String(value ?? '').trim();
        const m = raw.match(/(?:^|\/c\/)([A-Za-z0-9_-]{8,})(?:[/?#]|$)/);
        if (m) return m[1];
        if (/^[A-Za-z0-9_-]{8,}$/.test(raw)) return raw;
        throw new ArgumentError('invalid conversation id');
    },
    prepareChatGPTImagePaths: mocks.prepareChatGPTImagePaths,
    resolveAspectAriaLabel: (value) => {
        if (value === undefined || value === null) return null;
        const raw = String(value).trim();
        if (!raw) return null;
        const lower = raw.toLowerCase();
        if (ASPECT_ALIASES.has(lower)) return ASPECT_ALIASES.get(lower);
        throw new ArgumentError(`Unsupported --aspect "${raw}"`);
    },
    sendChatGPTMessage: mocks.sendChatGPTMessage,
    uploadChatGPTImages: mocks.uploadChatGPTImages,
    waitForChatGPTImages: mocks.waitForChatGPTImages,
    getChatGPTImageAssets: mocks.getChatGPTImageAssets,
    activateChatGPTImageTool: mocks.activateChatGPTImageTool,
    setChatGPTImageAspect: mocks.setChatGPTImageAspect,
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
    mocks.activateChatGPTImageTool.mockReset().mockResolvedValue(true);
    mocks.setChatGPTImageAspect.mockReset().mockResolvedValue(true);
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

    it('fails fast when the Image tool cannot be activated', async () => {
        mocks.activateChatGPTImageTool.mockResolvedValue(false);

        await expect(imageCommand.func(createPage(), {
            prompt: 'cat',
            op: '',
            sd: false,
            timeout: 240,
        })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('Failed to activate the ChatGPT Image tool'),
        });
        expect(mocks.sendChatGPTMessage).not.toHaveBeenCalled();
    });

    it('fails fast when the aspect ratio cannot be applied', async () => {
        mocks.setChatGPTImageAspect.mockResolvedValue(false);

        await expect(imageCommand.func(createPage(), {
            prompt: 'cat',
            op: '',
            sd: false,
            timeout: 240,
            aspect: '9:16',
        })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('Failed to set image aspect to "Story 9:16"'),
        });
        expect(mocks.sendChatGPTMessage).not.toHaveBeenCalled();
    });
});

describe('chatgpt image conversation continuation', () => {
    it('navigates to /c/<id> when --conv is supplied and sends the prompt verbatim', async () => {
        const page = createPage();
        await imageCommand.func(page, {
            prompt: 'make it brighter',
            op: '',
            sd: true,
            timeout: 240,
            conv: '123e4567-e89b-12d3-a456-426614174000',
        });

        expect(page.goto).toHaveBeenCalledWith(
            'https://chatgpt.com/c/123e4567-e89b-12d3-a456-426614174000',
            { settleMs: 2000 },
        );
        expect(mocks.sendChatGPTMessage).toHaveBeenCalledWith(expect.anything(), 'make it brighter');
    });

    it('extracts conversation id from a full /c/<id> URL', async () => {
        const page = createPage();
        await imageCommand.func(page, {
            prompt: 'redo',
            op: '',
            sd: true,
            timeout: 240,
            conv: 'https://chatgpt.com/c/abcdef-12345678/something',
        });

        expect(page.goto).toHaveBeenCalledWith(
            'https://chatgpt.com/c/abcdef-12345678',
            { settleMs: 2000 },
        );
    });

    it('defaults to /new when --conv is omitted and wraps the prompt', async () => {
        const page = createPage();
        await imageCommand.func(page, {
            prompt: 'a happy cat',
            op: '',
            sd: true,
            timeout: 240,
        });

        expect(page.goto).toHaveBeenCalledWith(
            'https://chatgpt.com/new',
            { settleMs: 2000 },
        );
        expect(mocks.sendChatGPTMessage).toHaveBeenCalledWith(expect.anything(), 'Generate an image of: a happy cat');
    });
});

describe('chatgpt image aspect ratio', () => {
    it('skips the aspect picker when --aspect is auto', async () => {
        await imageCommand.func(createPage(), {
            prompt: 'cat',
            op: '',
            sd: true,
            timeout: 240,
            aspect: 'auto',
        });
        expect(mocks.activateChatGPTImageTool).toHaveBeenCalled();
        expect(mocks.setChatGPTImageAspect).not.toHaveBeenCalled();
    });

    it('passes the canonical aria-label to setChatGPTImageAspect for Story 9:16', async () => {
        await imageCommand.func(createPage(), {
            prompt: 'cat',
            op: '',
            sd: true,
            timeout: 240,
            aspect: 'story',
        });
        expect(mocks.setChatGPTImageAspect).toHaveBeenCalledWith(expect.anything(), 'Story 9:16');
    });

    it('also accepts the bare 9:16 alias', async () => {
        await imageCommand.func(createPage(), {
            prompt: 'cat',
            op: '',
            sd: true,
            timeout: 240,
            aspect: '9:16',
        });
        expect(mocks.setChatGPTImageAspect).toHaveBeenCalledWith(expect.anything(), 'Story 9:16');
    });

    it('rejects an unknown aspect value', async () => {
        await expect(imageCommand.func(createPage(), {
            prompt: 'cat',
            op: '',
            sd: false,
            timeout: 240,
            aspect: 'panorama',
        })).rejects.toMatchObject({
            code: 'ARGUMENT',
            message: expect.stringContaining('Unsupported --aspect "panorama"'),
        });
    });
});
