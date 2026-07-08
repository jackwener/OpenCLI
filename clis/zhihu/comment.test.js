import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './comment.js';
describe('zhihu comment', () => {
    it('registers as a cookie browser command', () => {
        const cmd = getRegistry().get('zhihu/comment');
        expect(cmd).toBeDefined();
        expect(cmd.strategy).toBe('cookie');
        expect(cmd.browser).toBe(true);
    });
    it('creates a comment via API and returns result', async () => {
        const cmd = getRegistry().get('zhihu/comment');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn()
                .mockResolvedValueOnce({ slug: 'alice' })
                .mockResolvedValueOnce({ ok: true, id: 99, url: 'https://www.zhihu.com/api/v4/comments/99' }),
        };
        const rows = await cmd.func(page, { target: 'answer:1:2', text: 'hello', execute: true });
        expect(rows).toEqual([
            expect.objectContaining({ outcome: 'created', author_identity: 'alice' }),
        ]);
    });
    it('throws on API error', async () => {
        const cmd = getRegistry().get('zhihu/comment');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn()
                .mockResolvedValueOnce({ slug: 'alice' })
                .mockResolvedValueOnce({ ok: false, status: 403, message: 'forbidden' }),
        };
        await expect(cmd.func(page, { target: 'answer:1:2', text: 'hello', execute: true }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC' });
    });
    it('requires the comment API response to include the created id', async () => {
        const cmd = getRegistry().get('zhihu/comment');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn()
                .mockResolvedValueOnce({ slug: 'alice' })
                .mockResolvedValueOnce({ ok: false, status: 200, message: 'Comment API response did not include a created comment id' }),
        };
        await expect(cmd.func(page, { target: 'answer:1:2', text: 'hello', execute: true }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC' });
        expect(page.evaluate.mock.calls[1][0]).toContain('Comment API response did not include a created comment id');
    });
});
