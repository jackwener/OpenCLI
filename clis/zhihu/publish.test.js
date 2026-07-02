import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './publish.js';
function makePage(apiResult) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn()
            .mockResolvedValueOnce({ slug: 'alice' })
            .mockResolvedValueOnce(apiResult),
    };
}
describe('zhihu publish', () => {
    it('registers as a cookie browser command', () => {
        const cmd = getRegistry().get('zhihu/publish');
        expect(cmd).toBeDefined();
        expect(cmd.strategy).toBe('cookie');
        expect(cmd.browser).toBe(true);
        expect(cmd.access).toBe('write');
    });
    it('saves a private draft when --execute is omitted', async () => {
        const cmd = getRegistry().get('zhihu/publish');
        const page = makePage({ ok: true, id: '99', published: false, url: 'https://zhuanlan.zhihu.com/p/99/edit' });
        const rows = await cmd.func(page, { title: 'T', text: '<p>hi</p>' });
        expect(rows).toEqual([
            expect.objectContaining({
                status: 'success',
                outcome: 'draft_saved',
                article_id: '99',
                url: 'https://zhuanlan.zhihu.com/p/99/edit',
                author_identity: 'alice',
            }),
        ]);
    });
    it('publishes the article when --execute is set', async () => {
        const cmd = getRegistry().get('zhihu/publish');
        const page = makePage({ ok: true, id: '99', published: true, url: 'https://zhuanlan.zhihu.com/p/99' });
        const rows = await cmd.func(page, { title: 'T', text: '<p>hi</p>', execute: true });
        expect(rows).toEqual([
            expect.objectContaining({ outcome: 'published', article_id: '99', url: 'https://zhuanlan.zhihu.com/p/99' }),
        ]);
    });
    it('throws COMMAND_EXEC on API error', async () => {
        const cmd = getRegistry().get('zhihu/publish');
        const page = makePage({ ok: false, step: 'publish', status: 400, id: '99', message: 'forbidden' });
        await expect(cmd.func(page, { title: 'T', text: '<p>hi</p>', execute: true }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC' });
    });
    it('requires a title', async () => {
        const cmd = getRegistry().get('zhihu/publish');
        const page = makePage({ ok: true, id: '1', published: false, url: 'x' });
        await expect(cmd.func(page, { title: '   ', text: '<p>hi</p>' }))
            .rejects.toMatchObject({ code: 'INVALID_INPUT' });
    });
});
