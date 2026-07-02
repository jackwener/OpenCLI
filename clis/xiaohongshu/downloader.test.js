import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSpawnSync, mockMkdirSync, mockReadFileSync } = vi.hoisted(() => ({
    mockSpawnSync: vi.fn(),
    mockMkdirSync: vi.fn(),
    mockReadFileSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
    spawnSync: mockSpawnSync,
}));

vi.mock('node:fs', async () => {
    const actual = await vi.importActual('node:fs');
    return {
        ...actual,
        mkdirSync: mockMkdirSync,
        readFileSync: mockReadFileSync,
    };
});

import { getRegistry } from '@jackwener/opencli/registry';
import './downloader.js';
import { __test__ } from './downloader.js';

function responseText(body, { ok = true, status = 200 } = {}) {
    return {
        ok,
        status,
        text: vi.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
    };
}

function sampleBody() {
    return {
        message: '获取小红书作品数据成功',
        data: {
            作品ID: '69f9716c000000003601f90e',
            作品标题: '测试标题',
            作品描述: ' 第一行\n第二行 ',
            作者昵称: '作者 A',
            作者ID: 'user123',
            作品类型: '图文',
            发布时间: '2026-07-02 18:00:00',
            点赞数量: '1.2万',
            收藏数量: '345',
            评论数量: '6',
            下载地址: ['https://sns-img-bd.xhscdn.com/a.jpg'],
            动图地址: ['NaN', 'https://sns-img-bd.xhscdn.com/b.webp'],
            作品链接: 'https://www.xiaohongshu.com/explore/69f9716c000000003601f90e',
        },
    };
}

describe('xiaohongshu downloader', () => {
    const command = getRegistry().get('xiaohongshu/downloader');
    let mockFetch;

    beforeEach(() => {
        mockSpawnSync.mockReset();
        mockMkdirSync.mockReset();
        mockReadFileSync.mockReset();
        mockFetch = vi.fn();
        vi.stubGlobal('fetch', mockFetch);
    });

    it('starts an existing stopped container, waits for readiness, and posts detail payload', async () => {
        mockSpawnSync
            .mockReturnValueOnce({ status: 0, stdout: 'Docker version 27.0.0\n', stderr: '' })
            .mockReturnValueOnce({ status: 0, stdout: 'false\n', stderr: '' })
            .mockReturnValueOnce({ status: 0, stdout: 'xhs-downloader\n', stderr: '' });
        mockReadFileSync.mockReturnValue('web_session=secret\n');
        mockFetch
            .mockResolvedValueOnce(responseText('<html>docs</html>'))
            .mockResolvedValueOnce(responseText(sampleBody()));

        const rows = await command.func({
            url: 'http://xhslink.com/o/2J1jE00Sv9D',
            download: true,
            index: '1, 3',
            'cookie-file': '~/xhs.cookie',
            proxy: 'http://127.0.0.1:10808',
            skip: true,
            timeout: 30,
        });

        expect(mockSpawnSync).toHaveBeenNthCalledWith(1, 'docker', ['--version'], expect.any(Object));
        expect(mockSpawnSync).toHaveBeenNthCalledWith(2, 'docker', ['inspect', '-f', '{{.State.Running}}', 'xhs-downloader'], expect.any(Object));
        expect(mockSpawnSync).toHaveBeenNthCalledWith(3, 'docker', ['start', 'xhs-downloader'], expect.any(Object));
        expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining('XHS-Downloads'), { recursive: true });
        expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:5556/docs');
        expect(mockFetch.mock.calls[1][0]).toBe('http://localhost:5556/xhs/detail');
        expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({
            url: 'http://xhslink.com/o/2J1jE00Sv9D',
            download: true,
            index: [1, 3],
            cookie: 'web_session=secret',
            proxy: 'http://127.0.0.1:10808',
            skip: true,
        });
        expect(rows).toEqual([expect.objectContaining({
            noteId: '69f9716c000000003601f90e',
            title: '测试标题',
            description: '第一行 第二行',
            author: '作者 A',
            likes: 12000,
            collects: 345,
            comments: 6,
            mediaCount: 2,
            downloaded: true,
            mediaUrls: ['https://sns-img-bd.xhscdn.com/a.jpg', 'https://sns-img-bd.xhscdn.com/b.webp'],
        })]);
    });

    it('creates the service container when it does not exist', async () => {
        mockSpawnSync
            .mockReturnValueOnce({ status: 0, stdout: 'Docker version 27.0.0\n', stderr: '' })
            .mockReturnValueOnce({ status: 1, stdout: '', stderr: 'Error: No such object: xhs-downloader\n' })
            .mockReturnValueOnce({ status: 0, stdout: 'abc123\n', stderr: '' });
        mockFetch
            .mockResolvedValueOnce(responseText('<html>docs</html>'))
            .mockResolvedValueOnce(responseText(sampleBody()));

        await command.func({
            url: 'https://www.xiaohongshu.com/explore/69f9716c000000003601f90e?xsec_token=abc',
            timeout: 30,
        });

        expect(mockSpawnSync).toHaveBeenNthCalledWith(3, 'docker', [
            'run',
            '-d',
            '--name',
            'xhs-downloader',
            '-p',
            '5556:5556',
            '-v',
            expect.stringContaining('XHS-Downloads:/app/Volume'),
            'ghcr.io/joeanamier/xhs-downloader',
            'python',
            'main.py',
            'api',
        ], expect.any(Object));
    });

    it('honors --no-start by calling an already running service without Docker', async () => {
        mockFetch
            .mockResolvedValueOnce(responseText('<html>docs</html>'))
            .mockResolvedValueOnce(responseText(sampleBody()));

        await command.func({
            url: 'http://xhslink.com/o/2J1jE00Sv9D',
            'no-start': true,
            'api-base': 'http://127.0.0.1:5556',
            timeout: 30,
        });

        expect(mockSpawnSync).not.toHaveBeenCalled();
        expect(mockFetch.mock.calls[0][0]).toBe('http://127.0.0.1:5556/docs');
        expect(mockFetch.mock.calls[1][0]).toBe('http://127.0.0.1:5556/xhs/detail');
    });

    it('rejects unsupported input URLs before touching Docker or HTTP', async () => {
        await expect(command.func({ url: 'https://example.com/post/1', timeout: 30 })).rejects.toMatchObject({
            code: 'ARGUMENT',
            message: expect.stringContaining('only supports'),
        });
        expect(mockSpawnSync).not.toHaveBeenCalled();
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('normalizes counts, index lists, and empty downloader responses', () => {
        expect(__test__.parseCount('2.5万+')).toBe(25000);
        expect(__test__.parseCount('1.2k')).toBe(1200);
        expect(__test__.parseIndexList('1 2,3')).toEqual([1, 2, 3]);
        expect(() => __test__.parseIndexList('1,a')).toThrow(/positive integers/);
        expect(() => __test__.normalizeDetailResponse({ message: 'bad link', data: null }, 'http://xhslink.com/o/x', false, '/tmp')).toThrow(/returned no data/);
    });
});
