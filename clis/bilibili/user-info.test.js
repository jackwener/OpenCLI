import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockApiGet, mockFetchJson } = vi.hoisted(() => ({ mockApiGet: vi.fn(), mockFetchJson: vi.fn() }));
vi.mock('./utils.js', async (importOriginal) => ({
    ...(await importOriginal()),
    apiGet: mockApiGet,
    fetchJson: mockFetchJson,
}));

import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { __test__, BILIBILI_USER_INFO_COLUMNS } from './user-info.js';

const command = getRegistry().get('bilibili/user-info');

function accInfo(overrides = {}) {
    return {
        code: 0,
        data: {
            mid: 946974,
            name: '影视飓风',
            sign: '影视制作',
            level: 6,
            face: '//i2.hdslb.com/bfs/face/abc.jpg',
            official: { role: 3, title: 'bilibili 知名UP主', type: 0 },
            vip: { status: 1, type: 2 },
            ...overrides,
        },
    };
}

describe('bilibili user-info', () => {
    beforeEach(() => {
        mockApiGet.mockReset();
        mockFetchJson.mockReset();
    });

    it('combines acc/info and relation/stat into the documented row', async () => {
        mockApiGet.mockResolvedValue(accInfo());
        mockFetchJson.mockResolvedValue({ code: 0, data: { mid: 946974, following: 120, follower: 2000000 } });
        const [row] = await command.func({}, { mid: '946974' });
        expect(row).toEqual({
            mid: '946974',
            name: '影视飓风',
            sign: '影视制作',
            fans: 2000000,
            following: 120,
            level: 6,
            avatar: 'https://i2.hdslb.com/bfs/face/abc.jpg',
            official: 'bilibili 知名UP主',
            vip: true,
            url: 'https://space.bilibili.com/946974',
        });
        expect(Object.keys(row).sort()).toEqual([...BILIBILI_USER_INFO_COLUMNS].sort());
        expect(mockApiGet).toHaveBeenCalledWith({}, '/x/space/wbi/acc/info', { params: { mid: '946974' }, signed: true });
        expect(mockFetchJson).toHaveBeenCalledWith({}, 'https://api.bilibili.com/x/relation/stat?vmid=946974');
    });

    it('accepts space URLs and emits null counts when relation/stat fails', async () => {
        mockApiGet.mockResolvedValue(accInfo({ official: {}, vip: { status: 0 } }));
        mockFetchJson.mockResolvedValue({ code: -412, message: 'risk' });
        const [row] = await command.func({}, { mid: 'https://space.bilibili.com/946974' });
        expect(row).toMatchObject({ fans: null, following: null, official: null, vip: false });
    });

    it('maps -404 to EmptyResultError and other codes to CommandExecutionError', async () => {
        mockApiGet.mockResolvedValue({ code: -404, message: '啥都木有' });
        await expect(command.func({}, { mid: '1' })).rejects.toBeInstanceOf(EmptyResultError);
        mockApiGet.mockResolvedValue({ code: -352, message: '风控校验失败' });
        await expect(command.func({}, { mid: '1' })).rejects.toBeInstanceOf(CommandExecutionError);
        mockApiGet.mockResolvedValue('garbage');
        await expect(command.func({}, { mid: '1' })).rejects.toThrowError(/malformed payload/);
    });

    it('rejects empty input and requires a browser page', async () => {
        await expect(command.func({}, { mid: '' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func(null, { mid: '1' })).rejects.toBeInstanceOf(CommandExecutionError);
        expect(__test__.normalizeMidInput('https://space.bilibili.com/42/')).toBe('42');
        expect(__test__.normalizeMidInput('影视飓风')).toBe('影视飓风');
    });
});
