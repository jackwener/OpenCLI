import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './favorite.js';
describe('zhihu favorite', () => {
    it('registers as a cookie browser command', () => {
        const cmd = getRegistry().get('zhihu/favorite');
        expect(cmd).toBeDefined();
        expect(cmd.strategy).toBe('cookie');
    });
    it('favorites via API with collection-id', async () => {
        const cmd = getRegistry().get('zhihu/favorite');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValueOnce({ ok: true, collectionId: '123' }),
        };
        const rows = await cmd.func(page, { target: 'answer:1:2', 'collection-id': '123', execute: true });
        expect(rows).toEqual([expect.objectContaining({ outcome: 'applied', collection_id: '123' })]);
    });
    it('throws on API error', async () => {
        const cmd = getRegistry().get('zhihu/favorite');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValueOnce({ ok: false, message: 'collection not found' }),
        };
        await expect(cmd.func(page, { target: 'answer:1:2', 'collection-id': '123', execute: true }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC' });
    });
    it('requires exact normalized collection-name matches', async () => {
        const cmd = getRegistry().get('zhihu/favorite');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValueOnce({ ok: false, message: 'Collection not found: AI' }),
        };
        await expect(cmd.func(page, { target: 'answer:1:2', collection: 'AI', execute: true }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC' });
        expect(page.evaluate.mock.calls[0][0]).toContain('normalizeCollectionName(c.title) === needle');
        expect(page.evaluate.mock.calls[0][0]).not.toContain('.includes(needle)');
    });
    it('fails fast on ambiguous collection-name matches', async () => {
        const cmd = getRegistry().get('zhihu/favorite');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValueOnce({ ok: false, message: 'Collection name is ambiguous: 默认收藏夹' }),
        };
        await expect(cmd.func(page, { target: 'answer:1:2', collection: '默认收藏夹', execute: true }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC' });
        expect(page.evaluate.mock.calls[0][0]).toContain('matches.length > 1');
    });
    it('requires exactly one of --collection or --collection-id', async () => {
        const cmd = getRegistry().get('zhihu/favorite');
        const page = { goto: vi.fn(), wait: vi.fn(), evaluate: vi.fn() };
        await expect(cmd.func(page, { target: 'answer:1:2', execute: true }))
            .rejects.toMatchObject({ code: 'INVALID_INPUT' });
    });
});
