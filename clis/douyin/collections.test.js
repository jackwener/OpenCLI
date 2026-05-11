import { beforeEach, describe, expect, it, vi } from 'vitest';
const { browserFetchMock } = vi.hoisted(() => ({
    browserFetchMock: vi.fn(),
}));
vi.mock('./_shared/browser-fetch.js', () => ({
    browserFetch: browserFetchMock,
}));
import { getRegistry } from '@jackwener/opencli/registry';
import './collections.js';
describe('douyin collections', () => {
    beforeEach(() => {
        browserFetchMock.mockReset();
    });
    it('registers the collections command', () => {
        const registry = getRegistry();
        const cmd = [...registry.values()].find(c => c.site === 'douyin' && c.name === 'collections');
        expect(cmd).toBeDefined();
        expect(cmd?.args.some(a => a.name === 'limit')).toBe(true);
    });
    it('has expected columns', () => {
        const registry = getRegistry();
        const cmd = [...registry.values()].find(c => c.site === 'douyin' && c.name === 'collections');
        expect(cmd?.columns).toContain('mix_id');
        expect(cmd?.columns).toContain('name');
        expect(cmd?.columns).toContain('item_count');
    });
    it('uses COOKIE strategy', () => {
        const registry = getRegistry();
        const cmd = [...registry.values()].find(c => c.site === 'douyin' && c.name === 'collections');
        expect(cmd?.strategy).toBe('cookie');
    });
    it('uses the current mix list request shape', async () => {
        const registry = getRegistry();
        const command = [...registry.values()].find((cmd) => cmd.site === 'douyin' && cmd.name === 'collections');
        expect(command?.func).toBeDefined();
        if (!command?.func)
            throw new Error('douyin collections command not registered');
        browserFetchMock.mockResolvedValueOnce({
            mix_list: [],
        });
        const rows = await command.func({}, { limit: 12 });
        expect(browserFetchMock).toHaveBeenCalledWith({}, 'GET', 'https://creator.douyin.com/web/api/mix/list/?status=0,1,2,3,6&count=12&cursor=0&should_query_new_mix=1&device_platform=web&aid=1128');
        expect(rows).toEqual([]);
    });
});
