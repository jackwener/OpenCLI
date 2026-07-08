import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import { __test__ } from './quote.js';
import './quote.js';
import { createPageMock } from '../test-utils.js';

describe('twitter quote helpers', () => {
    it('builds the quote composer URL with the source tweet attached as ?url=...', () => {
        const composeUrl = __test__.buildQuoteComposerUrl('https://x.com/alice/status/2040254679301718161?s=20');
        // The full source URL is round-tripped via encodeURIComponent — decoding it
        // back must yield the original URL. This guards against accidental drops of
        // query parameters or fragment characters in future refactors.
        const parsed = new URL(composeUrl);
        expect(parsed.origin + parsed.pathname).toBe('https://x.com/compose/post');
        expect(parsed.searchParams.get('url')).toBe('https://x.com/alice/status/2040254679301718161?s=20');
    });

    it('rejects malformed URLs before any browser interaction', () => {
        expect(() => __test__.buildQuoteComposerUrl('https://x.com/alice/home')).toThrow(/Could not extract tweet ID/);
        expect(() => __test__.buildQuoteComposerUrl('not a url')).toThrow(/Invalid tweet URL/);
        expect(() => __test__.buildQuoteComposerUrl('https://evil.com/?next=https://x.com/alice/status/2040254679301718161')).toThrow(ArgumentError);
    });
});

describe('twitter quote command', () => {
    it('navigates to the quote composer and reports success when the script confirms', async () => {
        const cmd = getRegistry().get('twitter/quote');
        expect(cmd?.func).toBeTypeOf('function');
        const page = createPageMock([
            { ok: true, message: 'Quote tweet posted successfully.' },
        ]);
        const result = await cmd.func(page, {
            url: 'https://x.com/alice/status/2040254679301718161',
            text: 'great take',
        });
        expect(page.goto).toHaveBeenCalledWith(
            'https://x.com/compose/post?url=https%3A%2F%2Fx.com%2Falice%2Fstatus%2F2040254679301718161',
            { waitUntil: 'load', settleMs: 2500 },
        );
        expect(page.wait).toHaveBeenNthCalledWith(1, { selector: '[data-testid="tweetTextarea_0"]', timeout: 15 });
        expect(page.wait).toHaveBeenNthCalledWith(2, 3);
        const script = page.evaluate.mock.calls[0][0];
        // Quote-attachment guard: the script must verify the quoted card rendered
        // before submitting; otherwise we'd silently post a plain tweet without
        // the quote attachment. Detection now uses the shared helper's
        // __twHasLinkToTarget(document) — JSDOM coverage in shared.test.js
        // proves it does an exact (not substring) match on the status id.
        expect(script).toContain('Quote target did not render');
        expect(script).toContain('document.execCommand');
        expect(script).toContain('tweetButton');
        expect(script).toContain('__twHasLinkToTarget(document)');
        expect(script).toContain('__twGetStatusIdFromHref');
        expect(script).toContain('Quote tweet submission did not complete before timeout');
        expect(script).toContain('[role="alert"], [data-testid="toast"]');
        expect(result).toEqual([
            {
                status: 'success',
                message: 'Quote tweet posted successfully.',
                text: 'great take',
            },
        ]);
    });

    it('uploads a local image through the quote composer when --image is provided', async () => {
        const cmd = getRegistry().get('twitter/quote');
        expect(cmd?.func).toBeTypeOf('function');
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-twitter-quote-'));
        const imagePath = path.join(tempDir, 'banner.png');
        fs.writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        const setFileInput = vi.fn().mockResolvedValue(undefined);
        const page = createPageMock([
            { ok: true, previewCount: 1 },
            { ok: true, message: 'Quote tweet posted successfully.' },
        ], {
            setFileInput,
        });
        const result = await cmd.func(page, {
            url: 'https://x.com/alice/status/2040254679301718161',
            text: 'check this',
            image: imagePath,
        });
        expect(page.goto).toHaveBeenCalledWith(
            'https://x.com/compose/post?url=https%3A%2F%2Fx.com%2Falice%2Fstatus%2F2040254679301718161',
            { waitUntil: 'load', settleMs: 2500 },
        );
        expect(page.wait).toHaveBeenNthCalledWith(1, { selector: '[data-testid="tweetTextarea_0"]', timeout: 15 });
        expect(page.wait).toHaveBeenNthCalledWith(2, { selector: 'input[type="file"][data-testid="fileInput"]', timeout: 20 });
        expect(setFileInput).toHaveBeenCalledWith([imagePath], 'input[type="file"][data-testid="fileInput"]');
        expect(result).toEqual([
            {
                status: 'success',
                message: 'Quote tweet posted successfully.',
                text: 'check this',
                image: imagePath,
            },
        ]);
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('downloads a remote image before uploading when --image-url is provided', async () => {
        const cmd = getRegistry().get('twitter/quote');
        expect(cmd?.func).toBeTypeOf('function');
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            headers: {
                get: vi.fn().mockReturnValue('image/png'),
            },
            arrayBuffer: vi.fn().mockResolvedValue(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]).buffer),
        });
        vi.stubGlobal('fetch', fetchMock);
        const setFileInput = vi.fn().mockResolvedValue(undefined);
        const page = createPageMock([
            { ok: true, previewCount: 1 },
            { ok: true, message: 'Quote tweet posted successfully.' },
        ], {
            setFileInput,
        });
        const result = await cmd.func(page, {
            url: 'https://x.com/alice/status/2040254679301718161',
            text: 'remote attach',
            'image-url': 'https://example.com/banner',
        });
        expect(fetchMock).toHaveBeenCalledWith('https://example.com/banner');
        expect(setFileInput).toHaveBeenCalledTimes(1);
        const uploadedPath = setFileInput.mock.calls[0][0][0];
        expect(uploadedPath).toMatch(/opencli-twitter-.*\/image\.png$/);
        // Per-call tmp dir is removed in the adapter's finally block.
        expect(fs.existsSync(uploadedPath)).toBe(false);
        expect(result).toEqual([
            {
                status: 'success',
                message: 'Quote tweet posted successfully.',
                text: 'remote attach',
                'image-url': 'https://example.com/banner',
            },
        ]);
        vi.unstubAllGlobals();
    });

    it('rejects using --image and --image-url together', async () => {
        const cmd = getRegistry().get('twitter/quote');
        const page = createPageMock([]);
        await expect(cmd.func(page, {
            url: 'https://x.com/alice/status/2040254679301718161',
            text: 'nope',
            image: '/tmp/a.png',
            'image-url': 'https://example.com/a.png',
        })).rejects.toThrow(CommandExecutionError);
    });

    it('returns a failed row when the quote target fails to render', async () => {
        const cmd = getRegistry().get('twitter/quote');
        expect(cmd?.func).toBeTypeOf('function');
        const page = createPageMock([
            { ok: false, message: 'Quote target did not render in the composer. The source tweet may be deleted or restricted.' },
        ]);
        const result = await cmd.func(page, {
            url: 'https://x.com/alice/status/2040254679301718161',
            text: 'orphaned quote',
        });
        expect(result).toEqual([
            {
                status: 'failed',
                message: 'Quote target did not render in the composer. The source tweet may be deleted or restricted.',
                text: 'orphaned quote',
            },
        ]);
        // Only the textarea wait should run when ok is false (no extra 3s post-submit wait).
        expect(page.wait).toHaveBeenCalledTimes(1);
    });

    it('throws CommandExecutionError when no page is provided', async () => {
        const cmd = getRegistry().get('twitter/quote');
        await expect(cmd.func(undefined, {
            url: 'https://x.com/alice/status/2040254679301718161',
            text: 'hi',
        })).rejects.toThrow(CommandExecutionError);
    });

    it('rejects invalid tweet URLs before navigation', async () => {
        const cmd = getRegistry().get('twitter/quote');
        const page = createPageMock([]);
        await expect(cmd.func(page, {
            url: 'https://x.com.evil.com/alice/status/2040254679301718161',
            text: 'hi',
        })).rejects.toThrow(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });
});
