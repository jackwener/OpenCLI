import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './favorite.js';
describe('zhihu favorite', () => {
    it('rejects missing collection selectors before opening the chooser', async () => {
        const cmd = getRegistry().get('zhihu/favorite');
        expect(cmd?.func).toBeTypeOf('function');
        const page = { goto: vi.fn(), evaluate: vi.fn() };
        await expect(cmd.func(page, { target: 'article:1', execute: true })).rejects.toMatchObject({
            code: 'INVALID_INPUT',
        });
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });
    it('requires persisted read-back and preserves previously selected collections', async () => {
        const cmd = getRegistry().get('zhihu/favorite');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn()
                .mockResolvedValueOnce({
                chooserRows: [
                    { id: 'fav-a', name: '已存在', selected: true },
                    { id: 'fav-b', name: '默认收藏夹', selected: false },
                ],
                targetRowId: 'fav-b',
                targetRowName: '默认收藏夹',
            })
                .mockResolvedValueOnce({
                persisted: true,
                readbackSource: 'reopened_chooser',
                selectedBefore: ['fav-a'],
                selectedAfter: ['fav-a', 'fav-b'],
                targetSelected: true,
            }),
        };
        await expect(cmd.func(page, { target: 'article:1', collection: '默认收藏夹', execute: true })).resolves.toEqual([
            expect.objectContaining({ outcome: 'applied', collection_name: '默认收藏夹', target: 'article:1' }),
        ]);
        expect(page.evaluate.mock.calls[1][0]).toContain('waitForChooserRows(false)');
        expect(page.evaluate.mock.calls[1][0]).toContain("readbackSource");
    });
    it('requires persisted read-back before returning already_applied', async () => {
        const cmd = getRegistry().get('zhihu/favorite');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn()
                .mockResolvedValueOnce({
                chooserRows: [{ id: 'fav-a', name: '默认收藏夹', selected: true }],
                targetRowId: 'fav-a',
                targetRowName: '默认收藏夹',
            })
                .mockResolvedValueOnce({
                persisted: true,
                readbackSource: 'reopened_chooser',
                selectedAfter: ['fav-a'],
                targetSelected: true,
            }),
        };
        await expect(cmd.func(page, { target: 'article:1', collection: '默认收藏夹', execute: true })).resolves.toEqual([
            expect.objectContaining({ outcome: 'already_applied', collection_name: '默认收藏夹' }),
        ]);
    });
    it('accepts --collection-id as the stable selector path', async () => {
        const cmd = getRegistry().get('zhihu/favorite');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn()
                .mockResolvedValueOnce({
                chooserRows: [
                    { id: 'fav-a', name: '默认收藏夹', selected: false },
                    { id: 'fav-b', name: '同名收藏夹', selected: false },
                ],
                targetRowId: 'fav-b',
                targetRowName: null,
            })
                .mockResolvedValueOnce({
                persisted: true,
                readbackSource: 'reopened_chooser',
                selectedAfter: ['fav-b'],
                targetSelected: true,
            }),
        };
        await expect(cmd.func(page, { target: 'article:1', 'collection-id': 'fav-b', execute: true })).resolves.toEqual([
            expect.objectContaining({ outcome: 'applied', collection_id: 'fav-b' }),
        ]);
    });
    it('rejects duplicate collection names before selecting any row', async () => {
        const cmd = getRegistry().get('zhihu/favorite');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({
                chooserRows: [
                    { id: 'fav-a', name: '默认收藏夹', selected: false },
                    { id: 'fav-b', name: '默认收藏夹', selected: false },
                ],
            }),
        };
        await expect(cmd.func(page, { target: 'article:1', collection: '默认收藏夹', execute: true })).rejects.toMatchObject({ code: 'ACTION_NOT_AVAILABLE' });
    });
    it('rejects optimistic chooser state that was not re-read from a reopened chooser', async () => {
        const cmd = getRegistry().get('zhihu/favorite');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn()
                .mockResolvedValueOnce({
                chooserRows: [
                    { id: 'fav-a', name: '已存在', selected: true },
                    { id: 'fav-b', name: '默认收藏夹', selected: false },
                ],
                targetRowId: 'fav-b',
                targetRowName: '默认收藏夹',
            })
                .mockResolvedValueOnce({
                persisted: true,
                readbackSource: 'same_modal',
                selectedAfter: ['fav-a', 'fav-b'],
                targetSelected: true,
            }),
        };
        await expect(cmd.func(page, { target: 'article:1', collection: '默认收藏夹', execute: true })).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    });
    it('matches unique collection names even when chooser rows include extra UI text', async () => {
        const cmd = getRegistry().get('zhihu/favorite');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn()
                .mockResolvedValueOnce({
                chooserRows: [
                    { id: 'fav-b', name: '默认收藏夹 12 条内容', selected: false },
                ],
                targetRowId: null,
                targetRowName: '默认收藏夹',
            })
                .mockResolvedValueOnce({
                persisted: true,
                readbackSource: 'reopened_chooser',
                selectedAfter: ['fav-b'],
                targetSelected: true,
            }),
        };
        await expect(cmd.func(page, { target: 'article:1', collection: '默认收藏夹', execute: true })).resolves.toEqual([
            expect.objectContaining({ outcome: 'applied', collection_name: '默认收藏夹' }),
        ]);
        expect(page.evaluate.mock.calls[1][0]).toContain('normalizeCollectionName');
    });
    it('normalizes id-less row keys during reopened chooser verification', async () => {
        const cmd = getRegistry().get('zhihu/favorite');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn()
                .mockResolvedValueOnce({
                chooserRows: [
                    { id: '', name: '默认收藏夹 12 条内容', selected: false },
                ],
                targetRowId: null,
                targetRowName: '默认收藏夹',
            })
                .mockResolvedValueOnce({
                persisted: true,
                readbackSource: 'reopened_chooser',
                selectedAfter: ['name:默认收藏夹'],
                targetSelected: true,
            }),
        };
        await expect(cmd.func(page, { target: 'article:1', collection: '默认收藏夹', execute: true })).resolves.toEqual([
            expect.objectContaining({ outcome: 'applied', collection_name: '默认收藏夹' }),
        ]);
        expect(page.evaluate.mock.calls[1][0]).toContain("const rowKey = (row) => row.id || 'name:' + normalizeCollectionName(row.name);");
        expect(page.evaluate.mock.calls[1][0]).toContain('selectedAfter: chooserRows.filter((row) => row.selected).map(rowKey)');
    });
    it('reuses data-attribute answer anchoring during reopened chooser verification', async () => {
        const cmd = getRegistry().get('zhihu/favorite');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn()
                .mockResolvedValueOnce({
                chooserRows: [
                    { id: 'fav-b', name: '默认收藏夹', selected: false },
                ],
                targetRowId: 'fav-b',
                targetRowName: null,
            })
                .mockResolvedValueOnce({
                persisted: true,
                readbackSource: 'reopened_chooser',
                selectedAfter: ['fav-b'],
                targetSelected: true,
            }),
        };
        await expect(cmd.func(page, { target: 'answer:1:2', 'collection-id': 'fav-b', execute: true })).resolves.toEqual([
            expect.objectContaining({ outcome: 'applied', collection_id: 'fav-b', target: 'answer:1:2' }),
        ]);
        expect(page.evaluate.mock.calls[1][0]).toContain("node.getAttribute('data-answerid')");
        expect(page.evaluate.mock.calls[1][0]).toContain("node.getAttribute('data-zop-question-answer')");
    });
});
