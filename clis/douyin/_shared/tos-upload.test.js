import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PART_SIZE, computeAws4Headers, deleteResumeState, extractRegionFromHost, getResumeFilePath, loadResumeState, saveResumeState, } from './tos-upload.js';
// ── extractRegionFromHost ────────────────────────────────────────────────────
describe('extractRegionFromHost', () => {
    it('extracts region from standard TOS host', () => {
        expect(extractRegionFromHost('tos-cn-i-alisg.volces.com')).toBe('cn-i-alisg');
    });
    it('extracts region from beijing TOS host', () => {
        expect(extractRegionFromHost('tos-cn-beijing.ivolces.com')).toBe('cn-beijing');
    });
    it('falls back to cn-north-1 for unknown host', () => {
        expect(extractRegionFromHost('unknown.example.com')).toBe('cn-north-1');
    });
});
// ── Part chunking ────────────────────────────────────────────────────────────
describe('PART_SIZE and part chunking logic', () => {
    it('PART_SIZE is exactly 5 MB', () => {
        expect(PART_SIZE).toBe(5 * 1024 * 1024);
    });
    it('single file smaller than PART_SIZE fits in 1 part', () => {
        const fileSize = 1 * 1024 * 1024; // 1 MB
        const totalParts = Math.ceil(fileSize / PART_SIZE);
        expect(totalParts).toBe(1);
        const lastPartSize = fileSize - (totalParts - 1) * PART_SIZE;
        expect(lastPartSize).toBe(fileSize);
    });
    it('exactly 5 MB file produces 1 part', () => {
        const fileSize = PART_SIZE;
        expect(Math.ceil(fileSize / PART_SIZE)).toBe(1);
    });
    it('5 MB + 1 byte produces 2 parts', () => {
        const fileSize = PART_SIZE + 1;
        expect(Math.ceil(fileSize / PART_SIZE)).toBe(2);
    });
    it('100 MB file produces 20 parts of 5 MB each', () => {
        const fileSize = 100 * 1024 * 1024;
        const totalParts = Math.ceil(fileSize / PART_SIZE);
        expect(totalParts).toBe(20);
        // Each part is exactly PART_SIZE
        for (let i = 1; i <= totalParts; i++) {
            const offset = (i - 1) * PART_SIZE;
            const chunkSize = Math.min(PART_SIZE, fileSize - offset);
            expect(chunkSize).toBe(PART_SIZE);
        }
    });
    it('101 MB file produces 21 parts, last part is 1 MB', () => {
        const fileSize = 101 * 1024 * 1024;
        const totalParts = Math.ceil(fileSize / PART_SIZE);
        expect(totalParts).toBe(21);
        const lastOffset = (totalParts - 1) * PART_SIZE;
        const lastPartSize = fileSize - lastOffset;
        expect(lastPartSize).toBe(1 * 1024 * 1024);
    });
});
// ── Resume file serialization/deserialization ─────────────────────────────────
describe('resume state read/write', () => {
    let tmpDir;
    let resumePath;
    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tos-upload-test-'));
        resumePath = path.join(tmpDir, 'resume.json');
    });
    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });
    it('saves and loads resume state correctly', () => {
        const state = {
            uploadId: 'test-upload-id-123',
            fileSize: 12345678,
            parts: [
                { partNumber: 1, etag: '"abc123"' },
                { partNumber: 2, etag: '"def456"' },
            ],
        };
        saveResumeState(resumePath, state);
        const loaded = loadResumeState(resumePath, 12345678);
        expect(loaded).not.toBeNull();
        expect(loaded.uploadId).toBe('test-upload-id-123');
        expect(loaded.fileSize).toBe(12345678);
        expect(loaded.parts).toHaveLength(2);
        expect(loaded.parts[0]).toEqual({ partNumber: 1, etag: '"abc123"' });
        expect(loaded.parts[1]).toEqual({ partNumber: 2, etag: '"def456"' });
    });
    it('returns null when file does not exist', () => {
        const result = loadResumeState('/nonexistent/path/resume.json', 12345678);
        expect(result).toBeNull();
    });
    it('returns null when fileSize does not match', () => {
        const state = {
            uploadId: 'upload-id',
            fileSize: 100,
            parts: [],
        };
        saveResumeState(resumePath, state);
        // Different file size — should not resume
        const result = loadResumeState(resumePath, 999);
        expect(result).toBeNull();
    });
    it('returns null when JSON is malformed', () => {
        fs.writeFileSync(resumePath, 'not-valid-json', 'utf8');
        const result = loadResumeState(resumePath, 100);
        expect(result).toBeNull();
    });
    it('returns null when uploadId is missing', () => {
        const broken = { fileSize: 100, parts: [] };
        fs.writeFileSync(resumePath, JSON.stringify(broken), 'utf8');
        const result = loadResumeState(resumePath, 100);
        expect(result).toBeNull();
    });
    it('deletes resume file without throwing when file exists', () => {
        fs.writeFileSync(resumePath, '{}', 'utf8');
        expect(() => deleteResumeState(resumePath)).not.toThrow();
        expect(fs.existsSync(resumePath)).toBe(false);
    });
    it('deleteResumeState does not throw when file does not exist', () => {
        expect(() => deleteResumeState('/nonexistent/path/resume.json')).not.toThrow();
    });
    it('saveResumeState creates parent directories if missing', () => {
        const nestedPath = path.join(tmpDir, 'nested', 'deep', 'resume.json');
        const state = { uploadId: 'x', fileSize: 0, parts: [] };
        expect(() => saveResumeState(nestedPath, state)).not.toThrow();
        expect(fs.existsSync(nestedPath)).toBe(true);
    });
});
// ── getResumeFilePath ────────────────────────────────────────────────────────
describe('getResumeFilePath', () => {
    it('returns a path inside ~/.opencli/douyin-resume/', () => {
        const result = getResumeFilePath('/some/video/file.mp4');
        expect(result).toContain('douyin-resume');
        expect(result).toMatch(/\.json$/);
    });
    it('produces same path for same input', () => {
        const a = getResumeFilePath('/video.mp4');
        const b = getResumeFilePath('/video.mp4');
        expect(a).toBe(b);
    });
    it('produces different paths for different inputs', () => {
        const a = getResumeFilePath('/video1.mp4');
        const b = getResumeFilePath('/video2.mp4');
        expect(a).not.toBe(b);
    });
});
// ── computeAws4Headers ───────────────────────────────────────────────────────
describe('computeAws4Headers', () => {
    const mockCredentials = {
        access_key_id: 'AKIAIOSFODNN7EXAMPLE',
        secret_access_key: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        session_token: 'FQoGZXIvYXdzEJr//////////test-session-token',
        expired_time: Date.now() / 1000 + 3600,
    };
    it('returns Authorization header', () => {
        const headers = computeAws4Headers({
            method: 'PUT',
            url: 'https://tos-cn-i-alisg.volces.com/bucket/object?partNumber=1&uploadId=abc',
            headers: { 'content-type': 'application/octet-stream' },
            body: Buffer.from('hello'),
            credentials: mockCredentials,
            service: 'tos',
            region: 'cn-i-alisg',
            datetime: '20260325T120000Z',
        });
        expect(headers['Authorization']).toMatch(/^AWS4-HMAC-SHA256 Credential=/);
        expect(headers['Authorization']).toContain('AKIAIOSFODNN7EXAMPLE/20260325/cn-i-alisg/tos/aws4_request');
        expect(headers['Authorization']).toContain('SignedHeaders=');
        expect(headers['Authorization']).toContain('Signature=');
    });
    it('includes x-amz-date header', () => {
        const headers = computeAws4Headers({
            method: 'PUT',
            url: 'https://tos-cn-i-alisg.volces.com/bucket/object?partNumber=1&uploadId=abc',
            headers: {},
            body: Buffer.alloc(0),
            credentials: mockCredentials,
            service: 'tos',
            region: 'cn-i-alisg',
            datetime: '20260325T120000Z',
        });
        expect(headers['x-amz-date']).toBe('20260325T120000Z');
    });
    it('includes x-amz-security-token with session token', () => {
        const headers = computeAws4Headers({
            method: 'PUT',
            url: 'https://tos-cn-i-alisg.volces.com/bucket/object',
            headers: {},
            body: '',
            credentials: mockCredentials,
            service: 'tos',
            region: 'cn-i-alisg',
            datetime: '20260325T120000Z',
        });
        expect(headers['x-amz-security-token']).toBe(mockCredentials.session_token);
    });
    it('signed headers list is sorted', () => {
        const headers = computeAws4Headers({
            method: 'POST',
            url: 'https://tos-cn-i-alisg.volces.com/bucket/object?uploadId=abc',
            headers: { 'content-type': 'application/xml' },
            body: '<xml/>',
            credentials: mockCredentials,
            service: 'tos',
            region: 'cn-i-alisg',
            datetime: '20260325T120000Z',
        });
        const authHeader = headers['Authorization'];
        const signedHeadersMatch = authHeader.match(/SignedHeaders=([^,]+)/);
        expect(signedHeadersMatch).not.toBeNull();
        const signedHeadersList = signedHeadersMatch[1].split(';');
        const sorted = [...signedHeadersList].sort((a, b) => a.localeCompare(b));
        expect(signedHeadersList).toEqual(sorted);
    });
    it('produces deterministic signature for same inputs', () => {
        const opts = {
            method: 'PUT',
            url: 'https://tos-cn-i-alisg.volces.com/bucket/key?partNumber=1&uploadId=xyz',
            headers: { 'content-type': 'application/octet-stream' },
            body: Buffer.from('test-data'),
            credentials: mockCredentials,
            service: 'tos',
            region: 'cn-i-alisg',
            datetime: '20260325T120000Z',
        };
        const h1 = computeAws4Headers(opts);
        const h2 = computeAws4Headers(opts);
        expect(h1['Authorization']).toBe(h2['Authorization']);
    });
});
