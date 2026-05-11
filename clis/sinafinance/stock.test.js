import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './stock.js';

function textResponse(body) {
    return {
        ok: true,
        arrayBuffer: async () => Buffer.from(body, 'utf8'),
    };
}

describe('sinafinance stock command', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.stubGlobal('TextDecoder', class {
            decode(buf) {
                return Buffer.from(buf).toString('utf8');
            }
        });
    });

    it('prefers exact symbol match over partial symbol and name misses', async () => {
        const cmd = getRegistry().get('sinafinance/stock');
        expect(cmd?.func).toBeTypeOf('function');

        const fetchMock = vi.fn()
            .mockResolvedValueOnce(textResponse('var suggestvalue="x,41,,AAPL,苹果;x,41,,AAPLU,Apple Units";'))
            .mockResolvedValueOnce(textResponse('var hq_str_gb_AAPL="Apple Inc,189.98,1.23,0,1.56,0,188.50,180.00,195.00,175.00,1200000,0,3000000000000";'));
        vi.stubGlobal('fetch', fetchMock);

        const result = await cmd.func({ key: 'AAPL', market: 'auto' });

        expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://suggest3.sinajs.cn/suggest/type=11,31,41&key=AAPL', expect.any(Object));
        expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://hq.sinajs.cn/list=gb_AAPL', expect.any(Object));
        expect(result[0]).toMatchObject({
            Symbol: 'AAPL',
            Name: 'Apple Inc',
            Price: '189.98',
        });
    });

    it('still matches by display name when the query targets the company name', async () => {
        const cmd = getRegistry().get('sinafinance/stock');
        expect(cmd?.func).toBeTypeOf('function');

        const fetchMock = vi.fn()
            .mockResolvedValueOnce(textResponse('var suggestvalue="x,41,,AAPL,苹果;x,41,,AAPLU,Apple Units";'))
            .mockResolvedValueOnce(textResponse('var hq_str_gb_AAPL="苹果公司,189.98,1.23,0,1.56,0,188.50,180.00,195.00,175.00,1200000,0,3000000000000";'));
        vi.stubGlobal('fetch', fetchMock);

        const result = await cmd.func({ key: '苹果', market: 'auto' });

        expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://hq.sinajs.cn/list=gb_AAPL', expect.any(Object));
        expect(result[0]).toMatchObject({
            Symbol: 'AAPL',
            Name: '苹果公司',
        });
    });
});
