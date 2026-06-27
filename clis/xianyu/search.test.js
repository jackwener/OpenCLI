import { describe, expect, it, vi } from 'vitest';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import { __test__ } from './search.js';
import './search.js';
describe('xianyu search helpers', () => {
    it('normalizes limit into supported range', () => {
        expect(__test__.normalizeLimit(undefined)).toBe(20);
        expect(__test__.normalizeLimit(0)).toBe(1);
        expect(__test__.normalizeLimit(3.8)).toBe(3);
        expect(__test__.normalizeLimit(999)).toBe(__test__.MAX_LIMIT);
    });
    it('builds search URLs with encoded queries', () => {
        expect(__test__.buildSearchUrl('小鹏G9')).toBe('https://www.goofish.com/search?q=%E5%B0%8F%E9%B9%8FG9');
    });
});
describe('xianyu search price filter', () => {
    it('parses price arguments, returning null when omitted', () => {
        expect(__test__.parsePriceArg(undefined, 'min-price')).toBeNull();
        expect(__test__.parsePriceArg('', 'min-price')).toBeNull();
        expect(__test__.parsePriceArg('100000', 'min-price')).toBe(100000);
        expect(__test__.parsePriceArg(200000.5, 'max-price')).toBe(200000.5);
    });
    it('rejects negative or non-numeric price arguments', () => {
        expect(() => __test__.parsePriceArg('-1', 'min-price')).toThrow(ArgumentError);
        expect(() => __test__.parsePriceArg('abc', 'max-price')).toThrow(ArgumentError);
    });
    it('encodes priceRange the way goofish expects, filling open-ended bounds', () => {
        expect(__test__.buildSearchFilter(null, null)).toBe('');
        expect(__test__.buildSearchFilter(100000, 200000)).toBe('priceRange:100000,200000;');
        expect(__test__.buildSearchFilter(100000, null)).toBe('priceRange:100000,99999999;');
        expect(__test__.buildSearchFilter(null, 200000)).toBe('priceRange:0,200000;');
    });
});
describe('xianyu search region filter', () => {
    it('returns {} when no region is requested', () => {
        expect(__test__.buildExtraFilterValue('', '')).toBe('{}');
    });
    it('encodes a city alone (empty province)', () => {
        expect(JSON.parse(__test__.buildExtraFilterValue('', '深圳'))).toEqual({
            divisionList: [{ province: '', city: '深圳' }],
            excludeMultiPlacesSellers: '0',
            extraDivision: '',
        });
    });
    it('encodes a province alone, and a province+city pair', () => {
        expect(JSON.parse(__test__.buildExtraFilterValue('广东', '')).divisionList).toEqual([{ province: '广东', city: '' }]);
        expect(JSON.parse(__test__.buildExtraFilterValue('广东', '湛江')).divisionList).toEqual([{ province: '广东', city: '湛江' }]);
    });
});
function createPageMock(evaluateResult) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(evaluateResult),
    };
}
describe('xianyu search command', () => {
    const command = getRegistry().get('xianyu/search');
    it('keeps existing search columns while adding want count', () => {
        expect(command.columns).toEqual(['item_id', 'rank', 'title', 'price', 'condition', 'brand', 'location', 'badge', 'want', 'url']);
    });
    it('assigns contiguous ranks and passes item fields through', async () => {
        const page = createPageMock({
            items: [
                { item_id: '111', title: 'A', price: '¥130000', condition: '几乎全新', brand: '小鹏', location: '深圳', badge: '信用极好', want: '3', url: 'u1' },
                { item_id: '222', title: 'B', price: '¥185000', condition: '', brand: '', location: '深圳', badge: '', want: '0', url: 'u2' },
            ],
        });
        const rows = await command.func(page, { query: '小鹏G9', city: '深圳', 'min-price': 100000, 'max-price': 200000 });
        expect(rows.map((r) => r.rank)).toEqual([1, 2]);
        expect(rows.map((r) => r.item_id)).toEqual(['111', '222']);
        expect(rows[0]).toMatchObject({ rank: 1, price: '¥130000', condition: '几乎全新', brand: '小鹏', location: '深圳', badge: '信用极好' });
    });
    it('rejects an inverted price range before touching the page', async () => {
        const page = createPageMock({ items: [] });
        await expect(command.func(page, { query: '小鹏G9', 'min-price': 200000, 'max-price': 100000 })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.evaluate).not.toHaveBeenCalled();
    });
    it('throws AuthRequiredError when the search needs a login', async () => {
        const page = createPageMock({ error: 'auth-required' });
        await expect(command.func(page, { query: '小鹏G9' })).rejects.toBeInstanceOf(AuthRequiredError);
    });
    it('throws AuthRequiredError on an expired mtop session', async () => {
        const page = createPageMock({ error: 'mtop-response-error', error_code: 'FAIL_SYS_SESSION_EXPIRED', error_message: 'x' });
        await expect(command.func(page, { query: '小鹏G9' })).rejects.toBeInstanceOf(AuthRequiredError);
    });
    it('throws CommandExecutionError on verification blocks', async () => {
        const page = createPageMock({ error: 'blocked' });
        await expect(command.func(page, { query: '小鹏G9' })).rejects.toBeInstanceOf(CommandExecutionError);
    });
    it('throws CommandExecutionError on malformed mtop payloads', async () => {
        const page = createPageMock({ error: 'malformed-response', error_message: 'missing resultList' });
        await expect(command.func(page, { query: '小鹏G9' })).rejects.toBeInstanceOf(CommandExecutionError);
    });
    it('throws CommandExecutionError when evaluate does not return an items array', async () => {
        const page = createPageMock({});
        await expect(command.func(page, { query: '小鹏G9' })).rejects.toBeInstanceOf(CommandExecutionError);
    });
    it('throws EmptyResultError when nothing matches the filters', async () => {
        const page = createPageMock({ items: [] });
        await expect(command.func(page, { query: '小鹏G9', city: '湛江', 'min-price': 5000000 })).rejects.toBeInstanceOf(EmptyResultError);
    });
});
