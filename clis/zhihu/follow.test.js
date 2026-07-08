import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './follow.js';
describe('zhihu follow', () => {
    it('registers as a cookie browser command', () => {
        const cmd = getRegistry().get('zhihu/follow');
        expect(cmd).toBeDefined();
        expect(cmd.strategy).toBe('cookie');
    });
    it('follows via API and returns result', async () => {
        const cmd = getRegistry().get('zhihu/follow');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValueOnce({ ok: true }),
        };
        const rows = await cmd.func(page, { target: 'question:123', execute: true });
        expect(rows).toEqual([expect.objectContaining({ outcome: 'applied' })]);
    });
    it('uses the parsed user slug for user follow API calls', async () => {
        const cmd = getRegistry().get('zhihu/follow');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValueOnce({ ok: true }),
        };
        await cmd.func(page, { target: 'user:alice', execute: true });
        expect(page.evaluate.mock.calls[0][0]).toContain("'https://www.zhihu.com/api/v4/members/' + targetId + '/followers'");
        expect(page.evaluate.mock.calls[0][0]).toContain('var targetId = "alice"');
        expect(page.evaluate.mock.calls[0][0]).not.toContain('undefined');
    });
    it('throws on API error', async () => {
        const cmd = getRegistry().get('zhihu/follow');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValueOnce({ ok: false, message: 'already following' }),
        };
        await expect(cmd.func(page, { target: 'question:123', execute: true }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC' });
    });
});
