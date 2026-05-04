import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getChatGPTVisibleImageUrls: vi.fn(),
    sendChatGPTMessage: vi.fn(),
    waitForChatGPTImages: vi.fn(),
    getChatGPTImageAssets: vi.fn(),
    saveBase64ToFile: vi.fn(),
}));

vi.mock('./utils.js', () => ({
    getChatGPTVisibleImageUrls: mocks.getChatGPTVisibleImageUrls,
    sendChatGPTMessage: mocks.sendChatGPTMessage,
    waitForChatGPTImages: mocks.waitForChatGPTImages,
    getChatGPTImageAssets: mocks.getChatGPTImageAssets,
}));

vi.mock('@jackwener/opencli/utils', () => ({
    saveBase64ToFile: mocks.saveBase64ToFile,
}));

const { imageCommand, nextAvailablePath, resolveOutputDir } = await import('./image.js');

function createPage() {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue('https://chatgpt.com/c/test-conversation'),
    };
}

beforeEach(() => {
    vi.restoreAllMocks();
    mocks.getChatGPTVisibleImageUrls.mockReset().mockResolvedValue([]);
    mocks.sendChatGPTMessage.mockReset().mockResolvedValue(true);
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
});

describe('chatgpt image failure contracts', () => {
    it('fails fast when image generation detection finds no new images', async () => {
        mocks.waitForChatGPTImages.mockResolvedValue([]);

        await expect(imageCommand.func(createPage(), {
            prompt: 'cat',
            op: '',
            sd: false,
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
        })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('Failed to export generated ChatGPT image assets'),
        });
    });
});
