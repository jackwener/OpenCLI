import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './rolling-news.js';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('sinafinance rolling-news', () => {
    it('reads the public roll API and preserves the visible row contract', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                result: {
                    status: { code: 0, msg: 'succ' },
                    data: [{
                        title: '金价企稳',
                        ctime: '1787531937',
                        url: 'https://finance.sina.com.cn/example.shtml',
                    }],
                },
            }),
        });
        vi.stubGlobal('fetch', fetchMock);

        const command = getRegistry().get('sinafinance/rolling-news');
        await expect(command.func({})).resolves.toEqual([{
            column: '财经',
            title: '金价企稳',
            date: '08-24 08:38',
            url: 'https://finance.sina.com.cn/example.shtml',
        }]);

        const requested = new URL(fetchMock.mock.calls[0][0]);
        expect(requested.origin + requested.pathname).toBe('https://feed.mix.sina.com.cn/api/roll/get');
        expect(Object.fromEntries(requested.searchParams)).toEqual({
            pageid: '384',
            lid: '2519',
            k: '',
            num: '50',
            page: '1',
        });
    });

    it.each([
        ['status failure', { result: { status: { code: 1, msg: 'busy' } } }, CommandExecutionError],
        ['empty data', { result: { status: { code: 0 }, data: [] } }, EmptyResultError],
        ['malformed row', { result: { status: { code: 0 }, data: [{ title: '', ctime: '1', url: '' }] } }, CommandExecutionError],
    ])('rejects %s', async (_label, payload, errorType) => {
        const command = getRegistry().get('sinafinance/rolling-news');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => payload,
        }));
        await expect(command.func({})).rejects.toBeInstanceOf(errorType);
    });

    it('turns transport, HTTP, and JSON failures into typed errors', async () => {
        const command = getRegistry().get('sinafinance/rolling-news');

        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
        await expect(command.func({})).rejects.toBeInstanceOf(CommandExecutionError);

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
        await expect(command.func({})).rejects.toBeInstanceOf(CommandExecutionError);

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => { throw new SyntaxError('bad json'); },
        }));
        await expect(command.func({})).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
