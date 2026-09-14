import { describe, expect, it, vi } from 'vitest';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';

const mocks = vi.hoisted(() => ({
    startNewGeminiChat: vi.fn(),
    sendGeminiMessage: vi.fn(),
    getGeminiVisibleImageUrls: vi.fn(),
    waitForGeminiImages: vi.fn(),
    exportGeminiImages: vi.fn(),
}));

vi.mock('./utils.js', async () => {
    const actual = await vi.importActual('./utils.js');
    return {
        ...actual,
        startNewGeminiChat: mocks.startNewGeminiChat,
        sendGeminiMessage: mocks.sendGeminiMessage,
        getGeminiVisibleImageUrls: mocks.getGeminiVisibleImageUrls,
        waitForGeminiImages: mocks.waitForGeminiImages,
        exportGeminiImages: mocks.exportGeminiImages,
    };
});

import { beforeEach } from 'vitest';
beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset && m.mockReset());
});

import { imageWithRefCommand, uploadReferenceFilesToGeminiComposer } from './image-with-ref.js';

function makePage() {
    return {
        click: vi.fn().mockResolvedValue({ matches_n: 1, match_level: 'exact' }),
        wait: vi.fn().mockResolvedValue(undefined),
        uploadFiles: vi.fn().mockImplementation(async (ref, files) => ({
            uploaded: true,
            files: files.length,
            file_names: files.map((f) => f.split('/').pop()),
            target: ref,
            matches_n: 1,
            match_level: 'exact',
            multiple: true,
        })),
        evaluate: vi.fn().mockResolvedValue('https://gemini.google.com/app/abc'),
        nativeType: vi.fn().mockResolvedValue(undefined),
        nativeKeyPress: vi.fn().mockResolvedValue(undefined),
    };
}

describe('gemini image-with-ref helper', () => {
    it('clicks upload button + menuitem + uploads files in order', async () => {
        const page = makePage();
        await uploadReferenceFilesToGeminiComposer(page, ['/tmp/a.png', '/tmp/b.png']);
        expect(page.click).toHaveBeenCalledTimes(2);
        expect(page.click.mock.calls[0][0]).toBe('button[aria-label="上传和工具"]');
        expect(page.click.mock.calls[1][0]).toMatch(/cdk-overlay-container.*role="menuitem"/);
        expect(page.uploadFiles).toHaveBeenCalledWith('input[type=file]', ['/tmp/a.png', '/tmp/b.png']);
    });

    it('throws ArgumentError when no files are provided', async () => {
        const page = makePage();
        await expect(uploadReferenceFilesToGeminiComposer(page, [])).rejects.toBeInstanceOf(ArgumentError);
        expect(page.click).not.toHaveBeenCalled();
    });

    it('inserts 0.5s waits between clicks so CDK overlay can mount', async () => {
        const page = makePage();
        await uploadReferenceFilesToGeminiComposer(page, ['/tmp/a.png']);
        expect(page.wait).toHaveBeenCalledWith(0.5);
        expect(page.wait.mock.calls.length).toBe(2);
    });
});

describe('gemini image-with-ref command', () => {
    it('rejects empty prompt', async () => {
        await expect(imageWithRefCommand.func(makePage(), { prompt: '', ref: '/tmp/a.png' }))
            .rejects.toBeInstanceOf(ArgumentError);
    });

    it('rejects missing --ref', async () => {
        await expect(imageWithRefCommand.func(makePage(), { prompt: 'draw a cat', ref: '' }))
            .rejects.toBeInstanceOf(ArgumentError);
    });

    it('rejects non-positive --timeout', async () => {
        await expect(imageWithRefCommand.func(makePage(), { prompt: 'p', ref: '/tmp/a.png', timeout: 0 }))
            .rejects.toBeInstanceOf(ArgumentError);
        await expect(imageWithRefCommand.func(makePage(), { prompt: 'p', ref: '/tmp/a.png', timeout: -1 }))
            .rejects.toBeInstanceOf(ArgumentError);
    });

    it('splits comma-separated refs and uploads them all', async () => {
        mocks.getGeminiVisibleImageUrls.mockResolvedValue([]);
        mocks.waitForGeminiImages.mockResolvedValue(['https://example.com/gen.png']);
        mocks.exportGeminiImages.mockResolvedValue([{ dataUrl: 'data:image/png;base64,AAAA', mimeType: 'image/png' }]);

        const page = makePage();
        const rows = await imageWithRefCommand.func(page, {
            prompt: 'draw a cat',
            ref: '/tmp/a.png,/tmp/b.png,/tmp/c.png',
            timeout: 60,
            new: 'false',
        });

        expect(page.uploadFiles).toHaveBeenCalledWith('input[type=file]', ['/tmp/a.png', '/tmp/b.png', '/tmp/c.png']);
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toMatch(/refs: 3/);
    });

    it('starts a new chat when --new=true', async () => {
        mocks.startNewGeminiChat.mockResolvedValue(undefined);
        mocks.getGeminiVisibleImageUrls.mockResolvedValue([]);
        mocks.waitForGeminiImages.mockResolvedValue(['https://example.com/g.png']);
        mocks.exportGeminiImages.mockResolvedValue([{ dataUrl: 'data:image/png;base64,BBBB', mimeType: 'image/png' }]);

        const page = makePage();
        await imageWithRefCommand.func(page, { prompt: 'p', ref: '/tmp/a.png', new: 'true' });
        expect(mocks.startNewGeminiChat).toHaveBeenCalledWith(page);
    });

    it('does not start a new chat when --new=false (default)', async () => {
        mocks.getGeminiVisibleImageUrls.mockResolvedValue([]);
        mocks.waitForGeminiImages.mockResolvedValue(['https://example.com/g.png']);
        mocks.exportGeminiImages.mockResolvedValue([{ dataUrl: 'data:image/png;base64,CCCC', mimeType: 'image/png' }]);

        const page = makePage();
        await imageWithRefCommand.func(page, { prompt: 'p', ref: '/tmp/a.png' });
        expect(mocks.startNewGeminiChat).not.toHaveBeenCalled();
    });

    it('returns no-images row when Gemini produces nothing', async () => {
        mocks.getGeminiVisibleImageUrls.mockResolvedValue([]);
        mocks.waitForGeminiImages.mockResolvedValue([]);

        const page = makePage();
        const rows = await imageWithRefCommand.func(page, { prompt: 'p', ref: '/tmp/a.png', timeout: 5 });
        expect(rows[0].status).toMatch(/no-images/);
        expect(rows[0].status).toMatch(/refs: 1/);
    });

    it('throws CommandExecutionError when upload fails', async () => {
        const page = makePage();
        page.uploadFiles.mockResolvedValue({ uploaded: false, reason: 'not_file_input' });
        await expect(imageWithRefCommand.func(page, { prompt: 'p', ref: '/tmp/a.png' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });
});