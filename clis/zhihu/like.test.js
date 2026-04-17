import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './like.js';
describe('zhihu like', () => {
    it('rejects article pages where the like control is not uniquely anchored', async () => {
        const cmd = getRegistry().get('zhihu/like');
        expect(cmd?.func).toBeTypeOf('function');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({ state: 'ambiguous_article_like' }),
        };
        await expect(cmd.func(page, { target: 'article:9', execute: true })).rejects.toMatchObject({
            code: 'ACTION_NOT_AVAILABLE',
        });
    });
    it('returns already_applied for an already-liked article target', async () => {
        const cmd = getRegistry().get('zhihu/like');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({ state: 'already_liked' }),
        };
        await expect(cmd.func(page, { target: 'article:9', execute: true })).resolves.toEqual([
            expect.objectContaining({ outcome: 'already_applied', target_type: 'article', target: 'article:9' }),
        ]);
    });
    it('anchors to the requested answer block before clicking like', async () => {
        const cmd = getRegistry().get('zhihu/like');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({ state: 'liked' }),
        };
        await expect(cmd.func(page, { target: 'answer:123:456', execute: true })).resolves.toEqual([
            expect.objectContaining({ outcome: 'applied', target_type: 'answer', target: 'answer:123:456' }),
        ]);
        expect(page.goto).toHaveBeenCalledWith('https://www.zhihu.com/question/123/answer/456');
        expect(page.evaluate).toHaveBeenCalledTimes(1);
        expect(page.evaluate.mock.calls[0][0]).toContain('targetQuestionId');
        expect(page.evaluate.mock.calls[0][0]).toContain('"123"');
        expect(page.evaluate.mock.calls[0][0]).toContain('"456"');
        expect(page.evaluate.mock.calls[0][0]).toContain("node.getAttribute('data-answerid')");
        expect(page.evaluate.mock.calls[0][0]).toContain("node.getAttribute('data-zop-question-answer')");
    });
    it('rejects answer targets when the answer-level like control is not unique', async () => {
        const cmd = getRegistry().get('zhihu/like');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({ state: 'ambiguous_answer_like' }),
        };
        await expect(cmd.func(page, { target: 'answer:123:456', execute: true })).rejects.toMatchObject({
            code: 'ACTION_NOT_AVAILABLE',
        });
    });
    it('maps missing answer blocks to TARGET_NOT_FOUND', async () => {
        const cmd = getRegistry().get('zhihu/like');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({ state: 'wrong_answer' }),
        };
        await expect(cmd.func(page, { target: 'answer:123:456', execute: true })).rejects.toMatchObject({
            code: 'TARGET_NOT_FOUND',
        });
        expect(page.evaluate.mock.calls[0][0]).toContain("if (!block) return { state: 'wrong_answer' }");
    });
});
