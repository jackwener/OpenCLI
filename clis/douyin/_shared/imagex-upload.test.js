import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { applyImageUpload, commitImageUpload, COVER_SERVICE_ID, imagexUpload } from './imagex-upload.js';
// ── Helpers ──────────────────────────────────────────────────────────────────
function makeTempImage(ext = '.jpg') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imagex-test-'));
    const filePath = path.join(dir, `cover${ext}`);
    fs.writeFileSync(filePath, Buffer.from([0xff, 0xd8, 0xff, 0xe0])); // minimal JPEG header bytes
    return filePath;
}
const FAKE_UPLOAD_INFO = {
    upload_url: 'https://imagex.bytedance.com/upload/presigned/fake',
    store_uri: 'tos-cn-i-alisg.example.com/cover/abc123',
};
// ── Tests ─────────────────────────────────────────────────────────────────────
describe('imagexUpload', () => {
    let imagePath;
    beforeEach(() => {
        imagePath = makeTempImage('.jpg');
    });
    afterEach(() => {
        // Clean up temp files
        try {
            fs.unlinkSync(imagePath);
            fs.rmdirSync(path.dirname(imagePath));
        }
        catch {
            // ignore cleanup errors
        }
        vi.restoreAllMocks();
    });
    it('throws CommandExecutionError when image file does not exist', async () => {
        await expect(imagexUpload('/nonexistent/path/cover.jpg', FAKE_UPLOAD_INFO)).rejects.toThrow(CommandExecutionError);
        await expect(imagexUpload('/nonexistent/path/cover.jpg', FAKE_UPLOAD_INFO)).rejects.toThrow('Cover image file not found');
    });
    it('PUTs the image and returns store_uri on success', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            text: vi.fn().mockResolvedValue(''),
        });
        vi.stubGlobal('fetch', mockFetch);
        const result = await imagexUpload(imagePath, FAKE_UPLOAD_INFO);
        expect(result).toBe(FAKE_UPLOAD_INFO.store_uri);
        expect(mockFetch).toHaveBeenCalledOnce();
        const [url, init] = mockFetch.mock.calls[0];
        expect(url).toBe(FAKE_UPLOAD_INFO.upload_url);
        expect(init.method).toBe('PUT');
        expect(init.headers['Content-Type']).toBe('image/jpeg');
    });
    it('uses image/png Content-Type for .png files', async () => {
        const pngPath = makeTempImage('.png');
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            text: vi.fn().mockResolvedValue(''),
        });
        vi.stubGlobal('fetch', mockFetch);
        try {
            await imagexUpload(pngPath, FAKE_UPLOAD_INFO);
            const [, init] = mockFetch.mock.calls[0];
            expect(init.headers['Content-Type']).toBe('image/png');
        }
        finally {
            try {
                fs.unlinkSync(pngPath);
                fs.rmdirSync(path.dirname(pngPath));
            }
            catch {
                // ignore
            }
        }
    });
    it('throws CommandExecutionError on non-2xx PUT response', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 403,
            text: vi.fn().mockResolvedValue('Forbidden'),
        });
        vi.stubGlobal('fetch', mockFetch);
        await expect(imagexUpload(imagePath, FAKE_UPLOAD_INFO)).rejects.toThrow(CommandExecutionError);
        await expect(imagexUpload(imagePath, FAKE_UPLOAD_INFO)).rejects.toThrow('ImageX upload failed with status 403');
    });
});
const CREDENTIALS = { access_key_id: 'ak', secret_access_key: 'sk', session_token: 'token' };
function jsonResponse(payload, status = 200) {
    return { ok: status >= 200 && status < 300, status, text: vi.fn().mockResolvedValue(JSON.stringify(payload)) };
}
describe('imagexUpload with ImageX store auth', () => {
    let imagePath;
    beforeEach(() => {
        imagePath = makeTempImage('.png');
    });
    afterEach(() => {
        try {
            fs.unlinkSync(imagePath);
            fs.rmdirSync(path.dirname(imagePath));
        }
        catch {
            // ignore cleanup errors
        }
        vi.restoreAllMocks();
    });
    it('sends the store auth and a CRC32 of the image', async () => {
        const mockFetch = vi.fn().mockResolvedValue(jsonResponse({ success: 0, error: { code: 200, error_code: 0 } }));
        vi.stubGlobal('fetch', mockFetch);
        await expect(imagexUpload(imagePath, { ...FAKE_UPLOAD_INFO, auth: 'store-auth' })).resolves.toBe(FAKE_UPLOAD_INFO.store_uri);
        const [, init] = mockFetch.mock.calls[0];
        expect(init.headers.Authorization).toBe('store-auth');
        expect(init.headers['Content-CRC32']).toMatch(/^[0-9a-f]{8}$/);
    });
    it('throws when the upload host reports an error in a 200 body', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ code: 4004, apiversion: 'v1', message: 'Not Found' })));
        await expect(imagexUpload(imagePath, { ...FAKE_UPLOAD_INFO, auth: 'store-auth' })).rejects.toThrow('ImageX upload failed with error 4004');
    });
});
describe('applyImageUpload / commitImageUpload', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });
    it('signs ApplyImageUpload for the creator cover service and maps the upload address', async () => {
        const mockFetch = vi.fn().mockResolvedValue(jsonResponse({
            ResponseMetadata: { RequestId: 'req' },
            Result: { UploadAddress: { SessionKey: 'cover-session', UploadHosts: ['tos-upload.example.com'], StoreInfos: [{ StoreUri: 'tos-cn-i-x/abc.png', Auth: 'store-auth' }] } },
        }));
        vi.stubGlobal('fetch', mockFetch);
        await expect(applyImageUpload(CREDENTIALS, { fileExtension: '.png' })).resolves.toEqual({
            upload_url: 'https://tos-upload.example.com/tos-cn-i-x/abc.png',
            store_uri: 'tos-cn-i-x/abc.png',
            auth: 'store-auth',
            session_key: 'cover-session',
        });
        const [url, init] = mockFetch.mock.calls[0];
        const parsed = new URL(url);
        expect(parsed.host).toBe('imagex.bytedanceapi.com');
        expect(parsed.searchParams.get('Action')).toBe('ApplyImageUpload');
        expect(parsed.searchParams.get('ServiceId')).toBe(COVER_SERVICE_ID);
        expect(parsed.searchParams.get('FileExtension')).toBe('.png');
        expect(init.headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=ak\/\d{8}\/cn-north-1\/imagex\/aws4_request,/);
        expect(init.headers['x-amz-security-token']).toBe('token');
    });
    it('surfaces ImageX OpenAPI errors', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ResponseMetadata: { Error: { CodeN: 600003, Message: 'Invalid parameter' } } })));
        await expect(applyImageUpload(CREDENTIALS)).rejects.toThrow(CommandExecutionError);
    });
    it('throws when the apply response has no upload address', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ Result: { UploadAddress: { StoreInfos: [] } } })));
        await expect(applyImageUpload(CREDENTIALS)).rejects.toThrow('missing upload fields');
    });
    it('commits with a signed POST and returns the cover uri and size', async () => {
        const mockFetch = vi.fn().mockResolvedValue(jsonResponse({
            Result: {
                Results: [{ Uri: 'tos-cn-i-x/abc.png', UriStatus: 2000 }],
                PluginResult: [{ ImageUri: 'tos-cn-i-x/abc.png', ImageWidth: 1080, ImageHeight: 1920 }],
            },
        }));
        vi.stubGlobal('fetch', mockFetch);
        await expect(commitImageUpload(CREDENTIALS, 'cover-session')).resolves.toEqual({ uri: 'tos-cn-i-x/abc.png', width: 1080, height: 1920 });
        const [url, init] = mockFetch.mock.calls[0];
        expect(new URL(url).searchParams.get('Action')).toBe('CommitImageUpload');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({ SessionKey: 'cover-session' });
        expect(init.headers.Authorization).toContain('/imagex/aws4_request');
    });
    it('throws when the commit does not confirm the image', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ Result: { Results: [{ Uri: 'tos-cn-i-x/abc.png', UriStatus: 2001 }] } })));
        await expect(commitImageUpload(CREDENTIALS, 'cover-session')).rejects.toThrow('did not confirm the cover');
    });
});
