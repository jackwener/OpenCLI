import { beforeEach, describe, expect, it, vi } from 'vitest';
const { browserFetchMock } = vi.hoisted(() => ({
    browserFetchMock: vi.fn(),
}));
vi.mock('./_shared/browser-fetch.js', () => ({
    browserFetch: browserFetchMock,
}));
import { getRegistry } from '@jackwener/opencli/registry';
import './videos.js';

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
