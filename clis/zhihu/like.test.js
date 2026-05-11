import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './like.js';
describe('zhihu like', () => {
    it('registers as a cookie browser command', () => {
        const cmd = getRegistry().get('zhihu/like');
        expect(cmd).toBeDefined();
        expect(cmd.strategy).toBe('cookie');
    });
    it('likes via API and returns result', async () => {
        const cmd = getRegistry().get('zhihu/like');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValueOnce({ ok: true, success: true }),
        };
        const rows = await cmd.func(page, { target: 'answer:1:2', execute: true });
        expect(rows).toEqual([expect.objectContaining({ outcome: 'applied' })]);
    });
    it('throws on API error', async () => {
        const cmd = getRegistry().get('zhihu/like');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValueOnce({ ok: false, message: 'rate limited' }),
        };
        await expect(cmd.func(page, { target: 'answer:1:2', execute: true }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC' });
    });
    it('does not treat success=false API responses as a successful like', async () => {
        const cmd = getRegistry().get('zhihu/like');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValueOnce({ ok: false, message: 'Zhihu like API reported success=false' }),
        };
        await expect(cmd.func(page, { target: 'answer:1:2', execute: true }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC' });
        expect(page.evaluate.mock.calls[0][0]).toContain('data.success === false');
    });
});
