import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExistsSync, mockReadFileSync, mockMkdirSync, mockWriteFileSync, mockHomedir } = vi.hoisted(() => ({
    mockExistsSync: vi.fn(),
    mockReadFileSync: vi.fn(),
    mockMkdirSync: vi.fn(),
    mockWriteFileSync: vi.fn(),
    mockHomedir: vi.fn(() => '/Users/tester'),
}));

vi.mock('node:fs', () => ({
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    mkdirSync: mockMkdirSync,
    writeFileSync: mockWriteFileSync,
}));

vi.mock('node:os', () => ({
    homedir: mockHomedir,
}));

const { extractTranscriptText, getXiaoyuzhouCredentialFile, loadXiaoyuzhouCredentials, normalizeXiaoyuzhouCredentials, refreshXiaoyuzhouCredentials, requestXiaoyuzhouJson, shouldRefreshXiaoyuzhouCredentials, XIAOYUZHOU_TOKEN_TTL_MS } = await import('./auth.js');

function createJsonResponse(status, payload) {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: vi.fn().mockResolvedValue(JSON.stringify(payload)),
    };
}

describe('xiaoyuzhou auth helpers', () => {
    beforeEach(() => {
        mockExistsSync.mockReset();
        mockReadFileSync.mockReset();
        mockMkdirSync.mockReset();
        mockWriteFileSync.mockReset();
        vi.useRealTimers();
    });

    it('loads credentials from the local credential file', () => {
        mockExistsSync.mockReturnValue(true);
        mockReadFileSync.mockReturnValue(JSON.stringify({
            access_token: 'file-access',
            refresh_token: 'file-refresh',
            expires_at: 123,
        }));
        const credentials = loadXiaoyuzhouCredentials();
        expect(mockReadFileSync).toHaveBeenCalledWith(getXiaoyuzhouCredentialFile(), 'utf-8');
        expect(credentials.access_token).toBe('file-access');
        expect(credentials.refresh_token).toBe('file-refresh');
    });

    it('refreshes credentials and persists the updated token file', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-04-15T00:00:00Z'));
        const fetchMock = vi.fn().mockResolvedValue(createJsonResponse(200, {
            success: true,
            'x-jike-access-token': 'new-access',
            'x-jike-refresh-token': 'new-refresh',
        }));
        const refreshed = await refreshXiaoyuzhouCredentials(normalizeXiaoyuzhouCredentials({
            access_token: 'old-access',
            refresh_token: 'old-refresh',
            device_id: 'device-1',
            device_properties: 'props',
        }), fetchMock);
        expect(refreshed.access_token).toBe('new-access');
        expect(refreshed.refresh_token).toBe('new-refresh');
        expect(refreshed.expires_at).toBe(Date.now() + XIAOYUZHOU_TOKEN_TTL_MS);
        expect(mockMkdirSync).toHaveBeenCalledWith('/Users/tester/.opencli', { recursive: true });
        expect(mockWriteFileSync).toHaveBeenCalledWith('/Users/tester/.opencli/xiaoyuzhou.json', expect.stringContaining('"access_token": "new-access"'), 'utf-8');
    });

    it('retries once on 401 using refreshed credentials', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({
            ok: false,
            status: 401,
            text: vi.fn().mockResolvedValue('unauthorized'),
        })
            .mockResolvedValueOnce(createJsonResponse(200, {
            success: true,
            'x-jike-access-token': 'refreshed-access',
            'x-jike-refresh-token': 'refreshed-refresh',
        }))
            .mockResolvedValueOnce(createJsonResponse(200, {
            success: true,
            data: { title: 'Transcript Episode' },
        }));
        const result = await requestXiaoyuzhouJson('/v1/episode/get', {
            query: { eid: 'ep123' },
            credentials: normalizeXiaoyuzhouCredentials({
                access_token: 'old-access',
                refresh_token: 'old-refresh',
            }),
        }, fetchMock);
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(result.data).toEqual({ title: 'Transcript Episode' });
        expect(result.credentials.access_token).toBe('refreshed-access');
    });

    it('extracts transcript text from segment arrays and direct text payloads', () => {
        expect(extractTranscriptText(JSON.stringify({
            segments: [{ text: 'hello ' }, { text: ' world' }],
        }))).toEqual({
            text: 'hello\nworld',
            segmentCount: 2,
        });
        expect(extractTranscriptText(JSON.stringify({ text: 'full transcript' }))).toEqual({
            text: 'full transcript',
            segmentCount: 1,
        });
    });

    it('detects credentials that are close to expiry', () => {
        expect(shouldRefreshXiaoyuzhouCredentials({
            expires_at: Date.now() - 1,
        })).toBe(true);
        expect(shouldRefreshXiaoyuzhouCredentials({
            expires_at: Date.now() + 10 * 60 * 1000,
        })).toBe(false);
    });
});
