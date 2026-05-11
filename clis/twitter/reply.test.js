import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import { __test__ } from './reply.js';
import { __test__ as utilsTest } from './utils.js';
import { createPageMock } from '../test-utils.js';

describe('twitter reply command', () => {
    it('uses the dedicated reply composer for text-only replies too', async () => {
        const cmd = getRegistry().get('twitter/reply');
        expect(cmd?.func).toBeTypeOf('function');
        const page = createPageMock([
            { ok: true, message: 'Reply posted successfully.' },
        ]);
        const result = await cmd.func(page, {
            url: 'https://x.com/_kop6/status/2040254679301718161?s=20',
            text: 'text-only reply',
        });
        expect(page.goto).toHaveBeenCalledWith('https://x.com/compose/post?in_reply_to=2040254679301718161', { waitUntil: 'load', settleMs: 2500 });
        expect(page.wait).toHaveBeenCalledWith({ selector: '[data-testid="tweetTextarea_0"]', timeout: 15 });
        expect(result).toEqual([
            {
                status: 'success',
                message: 'Reply posted successfully.',
                text: 'text-only reply',
            },
        ]);
    });
    it('uploads a local image through the dedicated reply composer when --image is provided', async () => {
        const cmd = getRegistry().get('twitter/reply');
        expect(cmd?.func).toBeTypeOf('function');
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-twitter-reply-'));
        const imagePath = path.join(tempDir, 'qr.png');
        fs.writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        const setFileInput = vi.fn().mockResolvedValue(undefined);
        const page = createPageMock([
            { ok: true, previewCount: 1 },
            { ok: true, message: 'Reply posted successfully.' },
        ], {
            setFileInput,
        });
        const result = await cmd.func(page, {
            url: 'https://x.com/_kop6/status/2040254679301718161?s=20',
            text: 'reply with image',
            image: imagePath,
        });
        expect(page.goto).toHaveBeenCalledWith('https://x.com/compose/post?in_reply_to=2040254679301718161', { waitUntil: 'load', settleMs: 2500 });
        expect(page.wait).toHaveBeenNthCalledWith(1, { selector: '[data-testid="tweetTextarea_0"]', timeout: 15 });
        expect(page.wait).toHaveBeenNthCalledWith(2, { selector: 'input[type="file"][data-testid="fileInput"]', timeout: 20 });
        expect(setFileInput).toHaveBeenCalledWith([imagePath], 'input[type="file"][data-testid="fileInput"]');
        expect(result).toEqual([
            {
                status: 'success',
                message: 'Reply posted successfully.',
                text: 'reply with image',
                image: imagePath,
            },
        ]);
    });
    it('downloads a remote image before uploading when --image-url is provided', async () => {
        const cmd = getRegistry().get('twitter/reply');
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
            { ok: true, message: 'Reply posted successfully.' },
        ], {
            setFileInput,
        });
        const result = await cmd.func(page, {
            url: 'https://x.com/_kop6/status/2040254679301718161?s=20',
            text: 'reply with remote image',
            'image-url': 'https://example.com/qr',
        });
        expect(fetchMock).toHaveBeenCalledWith('https://example.com/qr');
        expect(setFileInput).toHaveBeenCalledTimes(1);
        const uploadedPath = setFileInput.mock.calls[0][0][0];
        // Tmp dir is created by utils.downloadRemoteImage with the
        // 'opencli-twitter-' prefix; final extension comes from Content-Type.
        expect(uploadedPath).toMatch(/opencli-twitter-.*\/image\.png$/);
        // Per-call tmp dir is removed in the adapter's finally block, so the
        // downloaded file no longer exists once the command returns.
        expect(fs.existsSync(uploadedPath)).toBe(false);
        expect(result).toEqual([
            {
                status: 'success',
                message: 'Reply posted successfully.',
                text: 'reply with remote image',
                'image-url': 'https://example.com/qr',
            },
        ]);
        vi.unstubAllGlobals();
    });
    it('rejects using --image and --image-url together', async () => {
        const cmd = getRegistry().get('twitter/reply');
        expect(cmd?.func).toBeTypeOf('function');
        const page = createPageMock([]);
        await expect(cmd.func(page, {
            url: 'https://x.com/_kop6/status/2040254679301718161?s=20',
            text: 'nope',
            image: '/tmp/a.png',
            'image-url': 'https://example.com/a.png',
        })).rejects.toThrow(CommandExecutionError);
    });
    it('rejects malformed tweet URLs before any browser interaction', () => {
        // buildReplyComposerUrl runs parseTweetUrl synchronously; substring matches
        // and off-domain hosts now throw ArgumentError instead of silently
        // producing a wrong-host /compose/post URL.
        expect(() => __test__.buildReplyComposerUrl('https://x.com/alice/home')).toThrow(ArgumentError);
        expect(() => __test__.buildReplyComposerUrl('https://x.com.evil.com/alice/status/2040254679301718161')).toThrow(ArgumentError);
        expect(() => __test__.buildReplyComposerUrl('not a url')).toThrow(ArgumentError);
    });
    it('builds the reply composer URL for both /<user>/status/<id> and /i/status/<id> shapes', () => {
        expect(__test__.buildReplyComposerUrl('https://x.com/_kop6/status/2040254679301718161?s=20'))
            .toBe('https://x.com/compose/post?in_reply_to=2040254679301718161');
        expect(__test__.buildReplyComposerUrl('https://x.com/i/status/2040318731105313143'))
            .toBe('https://x.com/compose/post?in_reply_to=2040318731105313143');
    });
});

describe('twitter image helpers (utils.js)', () => {
    it('rejects invalid image paths early', () => {
        expect(() => utilsTest.resolveImagePath('/tmp/does-not-exist.png'))
            .toThrow(ArgumentError);
    });
    it('prefers content-type when resolving remote image extensions', () => {
        expect(utilsTest.resolveImageExtension('https://example.com/no-ext', 'image/webp')).toBe('.webp');
        expect(utilsTest.resolveImageExtension('https://example.com/a.jpeg?x=1', null)).toBe('.jpeg');
    });
});
