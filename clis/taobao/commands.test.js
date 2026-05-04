import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './search.js';
import './detail.js';
import './reviews.js';
import './cart.js';
import './add-cart.js';
import { createPageMock } from '../test-utils.js';
describe('taobao command registration', () => {
    it('registers all taobao shopping commands', () => {
        for (const name of ['search', 'detail', 'reviews', 'cart', 'add-cart']) {
            expect(getRegistry().get(`taobao/${name}`)).toBeDefined();
        }
    });
});
describe('taobao command safety', () => {
    it('rejects invalid numeric ids before evaluating page scripts', async () => {
        const page = createPageMock();
        const detail = getRegistry().get('taobao/detail');
        await expect(detail.func(page, { id: 'bad-id' })).rejects.toMatchObject({
            name: 'ArgumentError',
            code: 'ARGUMENT',
        });
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });
    it('supports dry-run for add-cart without clicking add-to-cart', async () => {
        const page = createPageMock();
        const addCart = getRegistry().get('taobao/add-cart');
        const result = await addCart.func(page, { id: '827563850178', 'dry-run': true, spec: '红色 XL' });
        expect(result).toEqual([
            expect.objectContaining({
                status: 'dry-run',
                item_id: '827563850178',
            }),
        ]);
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.goto).toHaveBeenCalledWith('https://www.taobao.com');
        expect(page.evaluate).toHaveBeenCalledTimes(2);
    });
});
