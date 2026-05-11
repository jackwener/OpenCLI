import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './search.js';
import './detail.js';
import './reviews.js';
import './cart.js';
import './add-cart.js';
import { createPageMock } from '../test-utils.js';
describe('jd command registration', () => {
    it('registers all jd shopping commands', () => {
        for (const name of ['search', 'detail', 'reviews', 'cart', 'add-cart']) {
            expect(getRegistry().get(`jd/${name}`)).toBeDefined();
        }
    });
});
describe('jd command safety', () => {
    it('rejects invalid numeric sku before evaluating page scripts', async () => {
        const page = createPageMock();
        const detail = getRegistry().get('jd/detail');
        await expect(detail.func(page, { sku: 'abc' })).rejects.toMatchObject({
            name: 'ArgumentError',
            code: 'ARGUMENT',
        });
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });
    it('supports dry-run for add-cart without mutating the cart', async () => {
        const page = createPageMock();
        const addCart = getRegistry().get('jd/add-cart');
        const result = await addCart.func(page, { sku: '100291143898', 'dry-run': true });
        expect(result).toEqual([
            expect.objectContaining({
                status: 'dry-run',
                sku: '100291143898',
            }),
        ]);
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.goto).toHaveBeenCalledWith('https://item.jd.com/100291143898.html');
        expect(page.evaluate).toHaveBeenCalledTimes(1);
    });
});
