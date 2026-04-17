import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './follow.js';
describe('zhihu follow', () => {
    it('rejects missing --execute before any browser write path', async () => {
        const cmd = getRegistry().get('zhihu/follow');
        expect(cmd?.func).toBeTypeOf('function');
        const page = { goto: vi.fn(), evaluate: vi.fn() };
        await expect(cmd.func(page, { target: 'question:123' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });
    it('rejects user pages where the primary follow control is not uniquely anchored', async () => {
        const cmd = getRegistry().get('zhihu/follow');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({ state: 'ambiguous_user_follow' }),
        };
        await expect(cmd.func(page, { target: 'user:alice', execute: true })).rejects.toMatchObject({
            code: 'ACTION_NOT_AVAILABLE',
        });
    });
    it('returns already_applied when already following', async () => {
        const cmd = getRegistry().get('zhihu/follow');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({ state: 'already_following' }),
        };
        await expect(cmd.func(page, { target: 'question:123', execute: true })).resolves.toEqual([
            expect.objectContaining({ outcome: 'already_applied', target_type: 'question', target: 'question:123' }),
        ]);
    });
    it('rejects question pages where the question follow control is not uniquely anchored', async () => {
        const cmd = getRegistry().get('zhihu/follow');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({ state: 'ambiguous_question_follow' }),
        };
        await expect(cmd.func(page, { target: 'question:123', execute: true })).rejects.toMatchObject({
            code: 'ACTION_NOT_AVAILABLE',
        });
        expect(page.evaluate.mock.calls[0][0]).toContain('QuestionHeader');
        expect(page.evaluate.mock.calls[0][0]).toContain('new Set(');
    });
});
