import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';

const { mockLoadCredentials, mockRequestJson, mockFetchTranscriptBody, mockMkdirSync, mockWriteFileSync } = vi.hoisted(() => ({
    mockLoadCredentials: vi.fn(),
    mockRequestJson: vi.fn(),
    mockFetchTranscriptBody: vi.fn(),
    mockMkdirSync: vi.fn(),
    mockWriteFileSync: vi.fn(),
}));

vi.mock('./auth.js', async () => {
    const actual = await vi.importActual('./auth.js');
    return {
        ...actual,
        loadXiaoyuzhouCredentials: mockLoadCredentials,
        requestXiaoyuzhouJson: mockRequestJson,
        fetchXiaoyuzhouTranscriptBody: mockFetchTranscriptBody,
    };
});

vi.mock('node:fs', () => ({
    mkdirSync: mockMkdirSync,
    writeFileSync: mockWriteFileSync,
}));

await import('./transcript.js');

let cmd;

function toPosixPath(value) {
    return value.replaceAll(path.sep, '/');
}

beforeAll(() => {
    cmd = getRegistry().get('xiaoyuzhou/transcript');
    expect(cmd?.func).toBeTypeOf('function');
});

describe('xiaoyuzhou transcript', () => {
    beforeEach(() => {
        mockLoadCredentials.mockReset();
        mockRequestJson.mockReset();
        mockFetchTranscriptBody.mockReset();
        mockMkdirSync.mockReset();
        mockWriteFileSync.mockReset();
        mockLoadCredentials.mockReturnValue({ access_token: 'access', refresh_token: 'refresh' });
    });

    it('downloads transcript json and extracted text files', async () => {
        mockRequestJson
            .mockResolvedValueOnce({
            credentials: { access_token: 'access-1', refresh_token: 'refresh-1' },
            data: {
                title: 'Transcript Episode',
                podcast: { title: 'OpenCLI FM' },
                transcript: { mediaId: 'media-123' },
            },
        })
            .mockResolvedValueOnce({
            credentials: { access_token: 'access-1', refresh_token: 'refresh-1' },
            data: {
                transcriptUrl: 'https://cdn.example.com/transcript.json',
            },
        });
        mockFetchTranscriptBody.mockResolvedValue(JSON.stringify({
            segments: [{ text: 'hello' }, { text: 'world' }],
        }));
        const result = await cmd.func({
            id: 'ep123',
            output: '/tmp/xiaoyuzhou-transcripts',
            json: true,
            text: true,
        });
        expect(mockRequestJson).toHaveBeenNthCalledWith(1, '/v1/episode/get', {
            query: { eid: 'ep123' },
            credentials: { access_token: 'access', refresh_token: 'refresh' },
        });
        expect(mockRequestJson).toHaveBeenNthCalledWith(2, '/v1/episode-transcript/get', {
            method: 'POST',
            body: { eid: 'ep123', mediaId: 'media-123' },
            credentials: { access_token: 'access-1', refresh_token: 'refresh-1' },
        });
        expect(mockMkdirSync).toHaveBeenCalledWith('/tmp/xiaoyuzhou-transcripts/ep123', { recursive: true });
        expect(mockWriteFileSync).toHaveBeenNthCalledWith(1, '/tmp/xiaoyuzhou-transcripts/ep123/transcript.json', expect.any(String), 'utf-8');
        expect(mockWriteFileSync).toHaveBeenNthCalledWith(2, '/tmp/xiaoyuzhou-transcripts/ep123/transcript.txt', 'hello\nworld', 'utf-8');
        expect(result).toEqual([{
                title: 'Transcript Episode',
                podcast: 'OpenCLI FM',
                status: 'success',
                segments: '2',
                json_file: '/tmp/xiaoyuzhou-transcripts/ep123/transcript.json',
                text_file: '/tmp/xiaoyuzhou-transcripts/ep123/transcript.txt',
            }]);
    });

    it('derives mediaId from episode.media.id when transcript.mediaId is absent', async () => {
        mockRequestJson
            .mockResolvedValueOnce({
            credentials: { access_token: 'access-1', refresh_token: 'refresh-1' },
            data: {
                title: 'Transcript Episode',
                podcast: { title: 'OpenCLI FM' },
                media: { id: 'media-456' },
            },
        })
            .mockResolvedValueOnce({
            credentials: { access_token: 'access-1', refresh_token: 'refresh-1' },
            data: {
                transcriptUrl: 'https://cdn.example.com/transcript.json',
            },
        });
        mockFetchTranscriptBody.mockResolvedValue(JSON.stringify({ text: 'hello' }));
        await cmd.func({
            id: 'ep456',
            output: '/tmp/xiaoyuzhou-transcripts',
            json: false,
            text: true,
        });
        expect(mockRequestJson.mock.calls[1][1].body.mediaId).toBe('media-456');
        expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
        expect(mockWriteFileSync).toHaveBeenCalledWith('/tmp/xiaoyuzhou-transcripts/ep456/transcript.txt', 'hello', 'utf-8');
    });

    it('throws when transcript url is missing', async () => {
        mockRequestJson
            .mockResolvedValueOnce({
            credentials: { access_token: 'access-1', refresh_token: 'refresh-1' },
            data: {
                title: 'Transcript Episode',
                podcast: { title: 'OpenCLI FM' },
                transcript: { mediaId: 'media-123' },
            },
        })
            .mockResolvedValueOnce({
            credentials: { access_token: 'access-1', refresh_token: 'refresh-1' },
            data: {},
        });
        await expect(cmd.func({
            id: 'ep123',
            output: '/tmp/xiaoyuzhou-transcripts',
            json: true,
            text: true,
        })).rejects.toMatchObject({
            code: 'EMPTY_RESULT',
            message: 'Transcript URL not found',
        });
        expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('throws parse_error when transcript text extraction fails', async () => {
        mockRequestJson
            .mockResolvedValueOnce({
            credentials: { access_token: 'access-1', refresh_token: 'refresh-1' },
            data: {
                title: 'Transcript Episode',
                podcast: { title: 'OpenCLI FM' },
                transcript: { mediaId: 'media-123' },
            },
        })
            .mockResolvedValueOnce({
            credentials: { access_token: 'access-1', refresh_token: 'refresh-1' },
            data: {
                transcriptUrl: 'https://cdn.example.com/transcript.json',
            },
        });
        mockFetchTranscriptBody.mockResolvedValue(JSON.stringify({
            segments: [{ startAt: 0, endAt: 1 }],
        }));
        await expect(cmd.func({
            id: 'ep123',
            output: '/tmp/xiaoyuzhou-transcripts',
            json: true,
            text: true,
        })).rejects.toMatchObject({
            code: 'PARSE_ERROR',
            message: 'Failed to extract transcript text',
        });
        expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('rejects disabling both json and text outputs', async () => {
        await expect(cmd.func({
            id: 'ep123',
            output: '/tmp/xiaoyuzhou-transcripts',
            json: false,
            text: false,
        })).rejects.toMatchObject({
            code: 'ARGUMENT',
            message: 'At least one of --json or --text must be enabled',
        });
        expect(mockRequestJson).not.toHaveBeenCalled();
    });
});
