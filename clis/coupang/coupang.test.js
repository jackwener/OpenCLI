import { describe, expect, it } from 'vitest';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './search.js';
import './product.js';
import './add-to-cart.js';
import { parseLimitArg, parsePageArg, requireProductIdArg } from './utils.js';

describe('coupang utils — parseLimitArg / parsePageArg (no silent clamp)', () => {
    it('parseLimitArg returns fallback for empty / undefined', () => {
        expect(parseLimitArg(undefined, 20, 50)).toBe(20);
        expect(parseLimitArg(null, 20, 50)).toBe(20);
        expect(parseLimitArg('', 20, 50)).toBe(20);
    });

    it('parseLimitArg accepts integers in range', () => {
        expect(parseLimitArg(1, 20, 50)).toBe(1);
        expect(parseLimitArg(50, 20, 50)).toBe(50);
        expect(parseLimitArg('25', 20, 50)).toBe(25);
    });

    it('parseLimitArg throws ArgumentError on out-of-range / non-integer (no silent clamp)', () => {
        expect(() => parseLimitArg(0, 20, 50)).toThrow(ArgumentError);
        expect(() => parseLimitArg(-1, 20, 50)).toThrow(ArgumentError);
        expect(() => parseLimitArg(51, 20, 50)).toThrow(ArgumentError);
        expect(() => parseLimitArg(999, 20, 50)).toThrow(ArgumentError);
        expect(() => parseLimitArg('abc', 20, 50)).toThrow(ArgumentError);
        expect(() => parseLimitArg(1.5, 20, 50)).toThrow(ArgumentError);
    });

    it('parsePageArg returns fallback for empty', () => {
        expect(parsePageArg(undefined, 1)).toBe(1);
        expect(parsePageArg('', 1)).toBe(1);
    });

    it('parsePageArg accepts positive integers', () => {
        expect(parsePageArg(1, 1)).toBe(1);
        expect(parsePageArg('5', 1)).toBe(5);
    });

    it('parsePageArg throws ArgumentError on non-positive (no silent lift to 1)', () => {
        expect(() => parsePageArg(0, 1)).toThrow(ArgumentError);
        expect(() => parsePageArg(-1, 1)).toThrow(ArgumentError);
        expect(() => parsePageArg('abc', 1)).toThrow(ArgumentError);
    });
});

describe('coupang utils — product id validation', () => {
    it('extracts numeric ids from ids and URLs', () => {
        expect(requireProductIdArg('123456789')).toBe('123456789');
        expect(requireProductIdArg('https://www.coupang.com/vp/products/123456789?itemId=1', '--url')).toBe('123456789');
    });

    it('rejects malformed product ids instead of building fake URLs', () => {
        expect(() => requireProductIdArg('abc')).toThrow(ArgumentError);
        expect(() => requireProductIdArg('abc 123456789')).toThrow(ArgumentError);
        expect(() => requireProductIdArg('https://www.coupang.com/not-a-product', '--url')).toThrow(ArgumentError);
        expect(() => requireProductIdArg('https://www.coupang.com/not-a-product/123456789', '--url')).toThrow(ArgumentError);
        expect(() => requireProductIdArg('https://notcoupang.com/vp/products/123456789', '--url')).toThrow(ArgumentError);
        expect(() => requireProductIdArg('https://example.com/vp/products/123456789', '--url')).toThrow(ArgumentError);
    });
});

describe('coupang adapter registry shape', () => {
    it('search has product_id column for round-trip into product', () => {
        const search = getRegistry().get('coupang/search');
        expect(search).toBeDefined();
        expect(search.access).toBe('read');
        expect(search.columns).toContain('product_id');
        // Listing pairs with detail: id-shaped column present.
        const idShaped = search.columns.find((c) => /_id$|^id$/.test(c));
        expect(idShaped).toBe('product_id');
    });

    it('product cmd is a registered read adapter that pairs with search', () => {
        const product = getRegistry().get('coupang/product');
        expect(product).toBeDefined();
        expect(product.access).toBe('read');
        expect(product.columns).toContain('product_id');
        expect(product.columns).toContain('title');
        expect(product.columns).toContain('price');
        expect(product.columns).toContain('seller');
        expect(product.columns).toContain('rating');
    });

    it('add-to-cart remains write-class', () => {
        const cart = getRegistry().get('coupang/add-to-cart');
        expect(cart).toBeDefined();
        expect(cart.access).toBe('write');
    });
});

describe('coupang search — typed errors (no silent fallback)', () => {
    it('rejects empty query with ArgumentError', async () => {
        const search = getRegistry().get('coupang/search');
        // page object is irrelevant — we expect to fail before any browser call.
        const fakePage = { goto: () => { throw new Error('should not navigate'); } };
        await expect(search.func(fakePage, { query: '   ' })).rejects.toThrow(ArgumentError);
        await expect(search.func(fakePage, { query: '' })).rejects.toThrow(ArgumentError);
    });

    it('rejects unsupported --filter with ArgumentError', async () => {
        const search = getRegistry().get('coupang/search');
        const fakePage = { goto: () => { throw new Error('should not navigate'); } };
        await expect(search.func(fakePage, { query: 'mouse', filter: 'eco' })).rejects.toThrow(ArgumentError);
    });

    it('rejects out-of-range --limit with ArgumentError (no silent clamp to 50)', async () => {
        const search = getRegistry().get('coupang/search');
        const fakePage = { goto: () => { throw new Error('should not navigate'); } };
        await expect(search.func(fakePage, { query: 'mouse', limit: 999 })).rejects.toThrow(ArgumentError);
    });

    it('rejects out-of-range --page with ArgumentError', async () => {
        const search = getRegistry().get('coupang/search');
        const fakePage = { goto: () => { throw new Error('should not navigate'); } };
        await expect(search.func(fakePage, { query: 'mouse', page: 0 })).rejects.toThrow(ArgumentError);
    });
});

describe('coupang product — typed errors', () => {
    it('rejects missing --product-id and --url with ArgumentError', async () => {
        const product = getRegistry().get('coupang/product');
        const fakePage = { goto: () => { throw new Error('should not navigate'); } };
        await expect(product.func(fakePage, {})).rejects.toThrow(ArgumentError);
    });

    it('rejects malformed product id before navigation', async () => {
        const product = getRegistry().get('coupang/product');
        const fakePage = { goto: () => { throw new Error('should not navigate'); } };
        await expect(product.func(fakePage, { 'product-id': 'abc' })).rejects.toThrow(ArgumentError);
    });

    it('wraps browser failures as CommandExecutionError', async () => {
        const product = getRegistry().get('coupang/product');
        const fakePage = { goto: () => Promise.reject(new Error('browser down')) };
        await expect(product.func(fakePage, { 'product-id': '123456789' })).rejects.toThrow(CommandExecutionError);
    });
});

describe('coupang add-to-cart — typed errors', () => {
    it('rejects missing --product-id and --url with ArgumentError', async () => {
        const cart = getRegistry().get('coupang/add-to-cart');
        const fakePage = { goto: () => { throw new Error('should not navigate'); } };
        await expect(cart.func(fakePage, {})).rejects.toThrow(ArgumentError);
    });

    it('rejects malformed product id before navigation', async () => {
        const cart = getRegistry().get('coupang/add-to-cart');
        const fakePage = { goto: () => { throw new Error('should not navigate'); } };
        await expect(cart.func(fakePage, { 'product-id': 'abc' })).rejects.toThrow(ArgumentError);
    });

    it('wraps browser failures as CommandExecutionError', async () => {
        const cart = getRegistry().get('coupang/add-to-cart');
        const fakePage = { goto: () => Promise.reject(new Error('browser down')) };
        await expect(cart.func(fakePage, { 'product-id': '123456789' })).rejects.toThrow(CommandExecutionError);
    });
});
