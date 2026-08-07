import { beforeEach, describe, expect, it, vi } from 'vitest';
const { browserFetchMock } = vi.hoisted(() => ({
    browserFetchMock: vi.fn(),
}));
vi.mock('./_shared/browser-fetch.js', () => ({
    browserFetch: browserFetchMock,
}));
import { getRegistry } from '@jackwener/opencli/registry';
import { normalizeVideosLimit } from './videos.js';
function getCommand() {
    const command = [...getRegistry().values()].find((cmd) => cmd.site === 'douyin' && cmd.name === 'videos');
    if (!command?.func)
        throw new Error('douyin videos command not registered');
    return command;
}
function work(id, extra = {}) {
    return {
        aweme_id: id,
        desc: `标题 ${id}`,
        create_time: 1581571130,
        duration: 606367,
        statistics: { play_count: 1, digg_count: 2, comment_count: 3, collect_count: 4, share_count: 5 },
        ...extra,
    };
}
describe('douyin videos', () => {
    beforeEach(() => {
        browserFetchMock.mockReset();
    });
    it('registers the videos command', () => {
        expect(getCommand()).toBeDefined();
    });
    it('rejects invalid limits before fetching', async () => {
        const command = getCommand();
        expect(normalizeVideosLimit(undefined)).toBe(20);
        expect(normalizeVideosLimit(1)).toBe(1);
        expect(normalizeVideosLimit('2500')).toBe(2500);
        expect(() => normalizeVideosLimit(0)).toThrow('between 1 and 2500');
        expect(() => normalizeVideosLimit(2501)).toThrow('between 1 and 2500');
        expect(() => normalizeVideosLimit('1.5')).toThrow('between 1 and 2500');
        await expect(command.func({}, { limit: 0, status: 'all' })).rejects.toMatchObject({ code: 'ARGUMENT' });
        expect(browserFetchMock).not.toHaveBeenCalled();
    });
    it('parses the current creator work_list api shape', async () => {
        const command = getCommand();
        browserFetchMock.mockResolvedValueOnce({
            aweme_list: [
                {
                    aweme_id: '7000000000000000001',
                    desc: '测试视频标题',
                    create_time: 1581571130,
                    duration: 606367,
                    statistics: {
                        play_count: 0,
                        digg_count: 12,
                        comment_count: 3,
                        collect_count: 4,
                        share_count: 5,
                    },
                    status: {
                        is_private: true,
                    },
                },
            ],
        });
        const rows = await command.func({}, { limit: 5, status: 'all' });
        expect(rows).toEqual([
            {
                aweme_id: '7000000000000000001',
                title: '测试视频标题',
                status: 'private',
                play_count: 0,
                digg_count: 12,
                comment_count: 3,
                collect_count: 4,
                share_count: 5,
                duration: 606367,
                create_time: new Date(1581571130 * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Tokyo' }),
            },
        ]);
    });
    it('follows max_cursor until has_more is false', async () => {
        const command = getCommand();
        browserFetchMock
            .mockResolvedValueOnce({ aweme_list: [work('1'), work('2')], has_more: true, max_cursor: 1779021374000 })
            .mockResolvedValueOnce({ aweme_list: [work('3')], has_more: false, max_cursor: 0 });
        const rows = await command.func({}, { limit: 20, status: 'all' });
        expect(rows.map((r) => r.aweme_id)).toEqual(['1', '2', '3']);
        expect(browserFetchMock).toHaveBeenCalledTimes(2);
        expect(String(browserFetchMock.mock.calls[0][2])).not.toContain('max_cursor');
        expect(String(browserFetchMock.mock.calls[1][2])).toContain('max_cursor=1779021374000');
    });
    it('stops once limit is reached', async () => {
        const command = getCommand();
        browserFetchMock.mockResolvedValue({
            aweme_list: [work('1'), work('2'), work('3')],
            has_more: true,
            max_cursor: 10,
        });
        const rows = await command.func({}, { limit: 2, status: 'all' });
        expect(rows.map((r) => r.aweme_id)).toEqual(['1', '2']);
        expect(browserFetchMock).toHaveBeenCalledTimes(1);
    });
    it('stops when the cursor stops advancing', async () => {
        const command = getCommand();
        browserFetchMock.mockResolvedValue({ aweme_list: [work('1')], has_more: true, max_cursor: 7 });
        const rows = await command.func({}, { limit: 50, status: 'all' });
        expect(rows.map((r) => r.aweme_id)).toEqual(['1']);
        expect(browserFetchMock).toHaveBeenCalledTimes(2);
    });
    it('reads cursor metadata from a nested data payload', async () => {
        const command = getCommand();
        browserFetchMock
            .mockResolvedValueOnce({
            data: { work_list: [work('1')], has_more: true, max_cursor: '8' },
        })
            .mockResolvedValueOnce({
            data: { work_list: [work('2')], has_more: false, max_cursor: '0' },
        });
        const rows = await command.func({}, { limit: 20, status: 'all' });
        expect(rows.map((r) => r.aweme_id)).toEqual(['1', '2']);
        expect(String(browserFetchMock.mock.calls[1][2])).toContain('max_cursor=8');
    });
    it('keeps paging until the scheduled limit is satisfied', async () => {
        const command = getCommand();
        const future = Math.floor(Date.now() / 1000) + 3600;
        browserFetchMock
            .mockResolvedValueOnce({
            aweme_list: [work('1'), work('2')],
            has_more: true,
            max_cursor: 9,
        })
            .mockResolvedValueOnce({
            aweme_list: [work('3', { public_time: future })],
            has_more: false,
            max_cursor: 0,
        });
        const rows = await command.func({}, { limit: 1, status: 'scheduled' });
        expect(rows.map((r) => r.aweme_id)).toEqual(['3']);
        expect(browserFetchMock).toHaveBeenCalledTimes(2);
    });
    it('stops on an empty page', async () => {
        const command = getCommand();
        browserFetchMock
            .mockResolvedValueOnce({ aweme_list: [work('1')], has_more: true, max_cursor: 5 })
            .mockResolvedValueOnce({ aweme_list: [], has_more: true, max_cursor: 6 });
        const rows = await command.func({}, { limit: 20, status: 'all' });
        expect(rows.map((r) => r.aweme_id)).toEqual(['1']);
        expect(browserFetchMock).toHaveBeenCalledTimes(2);
    });
});
