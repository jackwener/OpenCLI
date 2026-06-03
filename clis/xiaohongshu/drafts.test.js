import { describe, expect, it, vi } from 'vitest';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './drafts.js';
import './draft-delete.js';
import './draft-clear.js';
import './draft-open.js';

function createPageMock(evaluateResults = []) {
    const evaluate = vi.fn();
    for (const result of evaluateResults) {
        evaluate.mockResolvedValueOnce(result);
    }
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate,
        wait: vi.fn().mockResolvedValue(undefined),
    };
}

const sampleDraft = {
    content: {
        contextStore: { liveContext: { title: '本地草稿' } },
        editorContent: { text: '草稿正文内容' },
        noteImageConfig: { items: [{}, {}] },
    },
    updatedAt: 1710000000000,
};

describe('xiaohongshu draft commands', () => {
    it('registers draft commands with correct access and side-effect guard columns', () => {
        expect(getRegistry().get('xiaohongshu/drafts')?.access).toBe('read');
        expect(getRegistry().get('xiaohongshu/draft-open')?.access).toBe('read');
        expect(getRegistry().get('xiaohongshu/draft-delete')?.access).toBe('write');
        expect(getRegistry().get('xiaohongshu/draft-clear')?.access).toBe('write');
        expect(getRegistry().get('xiaohongshu/draft-delete')?.columns).toEqual(['status', 'id', 'type', 'message']);
        expect(getRegistry().get('xiaohongshu/draft-clear')?.columns).toEqual(['status', 'type', 'count', 'message']);
    });

    it('rejects invalid draft types before browser navigation', async () => {
        const command = getRegistry().get('xiaohongshu/drafts');
        const page = createPageMock();

        await expect(command.func(page, { type: 'bogus' })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });

    it('lists drafts with stable typed ids so numeric and string keys do not collide', async () => {
        const command = getRegistry().get('xiaohongshu/drafts');
        const page = createPageMock([
            { ok: true, entries: [{ key: 12, row: sampleDraft }, { key: '12', row: { title: '字符串键' } }] },
        ]);

        const rows = await command.func(page, { type: 'image' });

        expect(rows).toMatchObject([
            { rank: 1, id: 'n:12', title: '本地草稿', images: 2, text_preview: '草稿正文内容' },
            { rank: 2, id: 's:12', title: '字符串键' },
        ]);
    });

    it('opens a draft by encoded id and returns full content', async () => {
        const command = getRegistry().get('xiaohongshu/draft-open');
        const page = createPageMock([
            { ok: true, entries: [{ key: 12, row: sampleDraft }] },
        ]);

        const rows = await command.func(page, { id: 'n:12', type: 'image' });

        expect(rows).toEqual([
            {
                id: 'n:12',
                type: 'image',
                title: '本地草稿',
                updated_at: '1710000000000',
                images: 2,
                content: '草稿正文内容',
            },
        ]);
    });

    it('fails typed when opening a missing draft id', async () => {
        const command = getRegistry().get('xiaohongshu/draft-open');
        const page = createPageMock([
            { ok: true, entries: [{ key: 12, row: sampleDraft }] },
        ]);

        await expect(command.func(page, { id: 'n:99', type: 'image' })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('does not accept raw untyped ids that can collide across IndexedDB key types', async () => {
        const command = getRegistry().get('xiaohongshu/draft-delete');
        const page = createPageMock([
            { ok: true, entries: [{ key: 12, row: sampleDraft }, { key: '12', row: { title: '字符串键' } }] },
        ]);

        await expect(command.func(page, { id: '12', type: 'image', execute: true })).rejects.toBeInstanceOf(EmptyResultError);
        expect(page.evaluate).toHaveBeenCalledTimes(1);
    });

    it('dry-runs draft-delete by default after proving the target exists', async () => {
        const command = getRegistry().get('xiaohongshu/draft-delete');
        const page = createPageMock([
            { ok: true, entries: [{ key: 12, row: sampleDraft }] },
        ]);

        const rows = await command.func(page, { id: 'n:12', type: 'image' });

        expect(rows).toEqual([
            {
                status: 'dry-run',
                id: 'n:12',
                type: 'image',
                message: 'Draft exists. Re-run with --execute to delete.',
            },
        ]);
        expect(page.evaluate).toHaveBeenCalledTimes(1);
    });

    it('executes draft-delete only with --execute and verifies disappearance', async () => {
        const command = getRegistry().get('xiaohongshu/draft-delete');
        const page = createPageMock([
            { ok: true, entries: [{ key: 12, row: sampleDraft }] },
            { ok: true, deleted: true },
        ]);

        const rows = await command.func(page, { id: 'n:12', type: 'image', execute: true });

        expect(rows[0]).toMatchObject({ status: 'deleted', id: 'n:12', type: 'image' });
        expect(page.evaluate).toHaveBeenCalledTimes(2);
        expect(page.evaluate.mock.calls[1][0]).toContain('store.delete(key)');
    });

    it('fails closed when draft-delete postcondition does not hold', async () => {
        const command = getRegistry().get('xiaohongshu/draft-delete');
        const page = createPageMock([
            { ok: true, entries: [{ key: 12, row: sampleDraft }] },
            { ok: true, deleted: false },
        ]);

        await expect(command.func(page, { id: 'n:12', type: 'image', execute: true })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('dry-runs draft-clear by default and only clears with --execute', async () => {
        const command = getRegistry().get('xiaohongshu/draft-clear');
        const dryRunPage = createPageMock([
            { ok: true, before: 3, after: 3, cleared: 0 },
        ]);
        const executePage = createPageMock([
            { ok: true, before: 3, after: 0, cleared: 3 },
        ]);

        await expect(command.func(dryRunPage, { type: 'all' })).resolves.toEqual([
            { status: 'dry-run', type: 'all', count: 3, message: 'Drafts counted. Re-run with --execute to clear.' },
        ]);
        await expect(command.func(executePage, { type: 'all', execute: true })).resolves.toEqual([
            { status: 'cleared', type: 'all', count: 3, message: 'Drafts cleared.' },
        ]);
        expect(dryRunPage.evaluate.mock.calls[0][0]).toContain('return { ok: true, before, after: before, cleared: 0 }');
        expect(executePage.evaluate.mock.calls[0][0]).toContain('clearStore(db, storeName)');
    });

    it('fails closed when draft-clear leaves drafts behind', async () => {
        const command = getRegistry().get('xiaohongshu/draft-clear');
        const page = createPageMock([
            { ok: true, before: 3, after: 1, cleared: 2 },
        ]);

        await expect(command.func(page, { type: 'image', execute: true })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
