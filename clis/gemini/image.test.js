import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getGeminiVisibleImageUrls: vi.fn(),
    sendGeminiMessage: vi.fn(),
    startNewGeminiChat: vi.fn(),
    waitForGeminiImages: vi.fn(),
    exportGeminiImages: vi.fn(),
    saveBase64ToFile: vi.fn(),
}));

vi.mock('./utils.js', () => ({
    GEMINI_DOMAIN: 'gemini.google.com',
    exportGeminiImages: mocks.exportGeminiImages,
    getGeminiVisibleImageUrls: mocks.getGeminiVisibleImageUrls,
    sendGeminiMessage: mocks.sendGeminiMessage,
    startNewGeminiChat: mocks.startNewGeminiChat,
    waitForGeminiImages: mocks.waitForGeminiImages,
}));

vi.mock('@jackwener/opencli/utils', () => ({
    saveBase64ToFile: mocks.saveBase64ToFile,
}));

const { imageCommand, resolveOutputDir } = await import('./image.js');

const page = { evaluate: vi.fn().mockResolvedValue('https://gemini.google.com/app/abc123') };
const kwargs = { prompt: 'a red maple leaf', rt: '1:1', st: '', op: '/tmp/gemini-test', sd: false, timeout: 60 };

beforeEach(() => {
    vi.clearAllMocks();
    mocks.getGeminiVisibleImageUrls.mockResolvedValue([]);
    mocks.startNewGeminiChat.mockResolvedValue(undefined);
    mocks.sendGeminiMessage.mockResolvedValue(undefined);
});

describe('gemini image output directory', () => {
    it('expands the home shorthand the default output path uses', () => {
        expect(resolveOutputDir('~/tmp/gemini-images')).toBe(path.join(os.homedir(), 'tmp', 'gemini-images'));
        expect(resolveOutputDir('~')).toBe(os.homedir());
    });

    it('resolves a relative path against the working directory', () => {
        expect(resolveOutputDir('out/images')).toBe(path.resolve('out/images'));
        expect(resolveOutputDir('')).toBe(path.join(os.homedir(), 'tmp', 'gemini-images'));
    });
});

describe('gemini image command', () => {
    it('typed-fails instead of returning a row when no image was produced', async () => {
        mocks.waitForGeminiImages.mockResolvedValue([]);

        await expect(imageCommand.func(page, kwargs)).rejects.toMatchObject({
            code: 'EMPTY_RESULT',
            exitCode: 66,
        });
        expect(mocks.saveBase64ToFile).not.toHaveBeenCalled();
    });

    it('typed-fails instead of returning a row when the export produced nothing', async () => {
        mocks.waitForGeminiImages.mockResolvedValue(['https://lh3.googleusercontent.com/final.png']);
        mocks.exportGeminiImages.mockResolvedValue([]);

        await expect(imageCommand.func(page, kwargs)).rejects.toMatchObject({ code: 'COMMAND_EXEC' });
        expect(mocks.saveBase64ToFile).not.toHaveBeenCalled();
    });

    it('saves the exported image and reports the file', async () => {
        mocks.waitForGeminiImages.mockResolvedValue(['https://lh3.googleusercontent.com/final.png']);
        mocks.exportGeminiImages.mockResolvedValue([
            { url: 'https://lh3.googleusercontent.com/final.png', dataUrl: 'data:image/png;base64,AAAA', mimeType: 'image/png', width: 1024, height: 1024 },
        ]);

        const rows = await imageCommand.func(page, kwargs);

        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe('✅ saved');
        expect(mocks.saveBase64ToFile).toHaveBeenCalledWith('AAAA', expect.stringContaining(path.join(path.resolve(kwargs.op), 'gemini_')));
    });
});
