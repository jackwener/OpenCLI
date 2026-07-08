import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';

const { mockRequestJson, mockLoadCredentials, mockHttpDownload, mockMkdirSync } = vi.hoisted(() => ({
    mockRequestJson: vi.fn(),
    mockLoadCredentials: vi.fn(),
    mockHttpDownload: vi.fn(),
    mockMkdirSync: vi.fn(),
}));

vi.mock('./auth.js', async () => {
    const actual = await vi.importActual('./auth.js');
    return {
        ...actual,
        requestXiaoyuzhouJson: mockRequestJson,
        loadXiaoyuzhouCredentials: mockLoadCredentials,
    };
});

vi.mock('@jackwener/opencli/download', () => ({
    httpDownload: mockHttpDownload,
    sanitizeFilename: vi.fn((value) => value.replace(/\s+/g, '_')),
}));

vi.mock('@jackwener/opencli/download/progress', () => ({
    formatBytes: vi.fn((size) => `${size} B`),
}));

vi.mock('node:fs', () => ({
    mkdirSync: mockMkdirSync,
}));

await import('./download.js');

let cmd;

function toPosixPath(value) {
    return value.replaceAll(path.sep, '/');
}

beforeAll(() => {
    cmd = getRegistry().get('xiaoyuzhou/download');
    expect(cmd?.func).toBeTypeOf('function');
});

describe('xiaoyuzhou download', () => {
    beforeEach(() => {
        mockRequestJson.mockReset();
        mockLoadCredentials.mockReset();
        mockHttpDownload.mockReset();
        mockMkdirSync.mockReset();
        mockLoadCredentials.mockReturnValue({});
    });

    it('downloads audio from media.source.url into an episode subdirectory', async () => {
        mockRequestJson.mockResolvedValue({
            credentials: {},
            data: {
                title: 'Hello World',
                podcast: { title: 'OpenCLI FM' },
                media: {
                    source: {
                        url: 'https://media.xyzcdn.net/audio/hello-world.mp3?sign=abc',
                    },
                },
            },
        });
        mockHttpDownload.mockResolvedValue({ success: true, size: 1234 });

        const result = await cmd.func({
            id: 'ep123',
            output: '/tmp/xiaoyuzhou-test',
        });

        expect(mockRequestJson).toHaveBeenCalledWith('/v1/episode/get', {
            query: { eid: 'ep123' },
            credentials: {},
        });
        expect(toPosixPath(mockMkdirSync.mock.calls[0][0])).toBe('/tmp/xiaoyuzhou-test/ep123');
        expect(mockMkdirSync.mock.calls[0][1]).toEqual({ recursive: true });
        expect(mockHttpDownload).toHaveBeenCalledWith('https://media.xyzcdn.net/audio/hello-world.mp3?sign=abc', expect.stringContaining('/tmp/xiaoyuzhou-test/ep123/ep123_Hello_World.mp3'), {
            timeout: 60000,
        });
        expect(result).toEqual([{
                title: 'Hello World',
                podcast: 'OpenCLI FM',
                status: 'success',
                size: '1234 B',
                file: '/tmp/xiaoyuzhou-test/ep123/ep123_Hello_World.mp3',
            }]);
    });

    it('preserves non-mp3 extensions from media.source.url', async () => {
        mockRequestJson.mockResolvedValue({
            credentials: {},
            data: {
                title: 'Lossless Episode',
                podcast: { title: 'OpenCLI FM' },
                media: {
                    source: {
                        url: 'https://media.xyzcdn.net/audio/lossless.m4a',
                    },
                },
            },
        });
        mockHttpDownload.mockResolvedValue({ success: true, size: 2048 });

        const result = await cmd.func({
            id: 'ep456',
            output: '/tmp/xiaoyuzhou-test',
        });

        expect(mockHttpDownload.mock.calls[0][1]).toContain('ep456_Lossless_Episode.m4a');
        expect(result[0].file).toBe('/tmp/xiaoyuzhou-test/ep456/ep456_Lossless_Episode.m4a');
    });

    it('throws when media.source.url is missing', async () => {
        mockRequestJson.mockResolvedValue({
            credentials: {},
            data: {
                title: 'No Audio',
                podcast: { title: 'OpenCLI FM' },
                media: {},
            },
        });

        await expect(cmd.func({ id: 'ep789', output: '/tmp/xiaoyuzhou-test' })).rejects.toMatchObject({
            code: 'PARSE_ERROR',
            message: 'Audio URL not found in episode payload',
            hint: 'Episode payload does not expose media.source.url',
        });
        expect(mockHttpDownload).not.toHaveBeenCalled();
    });
});
