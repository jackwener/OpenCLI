/**
 * Tests for the fs.readSync short-read guard in tosUpload.
 *
 * This file is separate from tos-upload.test.ts because vi.mock is hoisted and
 * would interfere with the real-fs tests there.
 *
 * Strategy:
 * - Use setReadSyncOverride (exported testing seam) to force readSync to return 0
 * - Mock global fetch to satisfy initMultipartUpload so the code path reaches readSync
 */
import * as actualFs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { setReadSyncOverride, tosUpload } from './tos-upload.js';
/** Build a minimal fetch mock that satisfies initMultipartUpload (POST ?uploads → 200 + UploadId XML). */
function makeFetchMock() {
    return vi.fn().mockResolvedValue({
        status: 200,
        text: async () => '<InitiateMultipartUploadResult><UploadId>mock-upload-id</UploadId></InitiateMultipartUploadResult>',
        headers: { forEach: (_cb) => { } },
    });
}
describe('tosUpload short-read guard', () => {
    let tmpDir;
    let tmpFile;
    let originalFetch;
    beforeEach(() => {
        originalFetch = globalThis.fetch;
        tmpDir = actualFs.mkdtempSync(path.join(os.tmpdir(), 'tos-upload-shortread-'));
        tmpFile = path.join(tmpDir, 'video.mp4');
        // 100-byte file — fits in a single part
        actualFs.writeFileSync(tmpFile, Buffer.alloc(100, 0xff));
    });
    afterEach(() => {
        setReadSyncOverride(null);
        globalThis.fetch = originalFetch;
        actualFs.rmSync(tmpDir, { recursive: true, force: true });
    });
    it('throws CommandExecutionError on short read', async () => {
        // Mock fetch so initMultipartUpload succeeds and code reaches readSync
        globalThis.fetch = makeFetchMock();
        // Override readSync to return 0 (fewer bytes than requested)
        setReadSyncOverride(() => 0);
        const mockCredentials = {
            access_key_id: 'AKIAIOSFODNN7EXAMPLE',
            secret_access_key: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
            session_token: 'test-session-token',
            expired_time: Date.now() / 1000 + 3600,
        };
        const uploadInfo = {
            tos_upload_url: 'https://tos-cn-i-alisg.volces.com/bucket/key',
            auth: 'AWS4-HMAC-SHA256 Credential=test',
            video_id: 'test-video-id',
        };
        await expect(tosUpload({
            filePath: tmpFile,
            uploadInfo,
            credentials: mockCredentials,
        })).rejects.toThrow(CommandExecutionError);
    });
    it('error message identifies the part number and byte counts', async () => {
        globalThis.fetch = makeFetchMock();
        setReadSyncOverride(() => 0);
        const mockCredentials = {
            access_key_id: 'AKIAIOSFODNN7EXAMPLE',
            secret_access_key: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
            session_token: 'test-session-token',
            expired_time: Date.now() / 1000 + 3600,
        };
        const uploadInfo = {
            tos_upload_url: 'https://tos-cn-i-alisg.volces.com/bucket/key',
            auth: 'AWS4-HMAC-SHA256 Credential=test',
            video_id: 'test-video-id',
        };
        await expect(tosUpload({
            filePath: tmpFile,
            uploadInfo,
            credentials: mockCredentials,
        })).rejects.toThrow(/Short read on part 1: expected 100 bytes, got 0/);
    });
});
