import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './hot.js';
import { __test__ } from './hot.js';

describe('zhihu hot', () => {
    it('returns hot items from the Zhihu hot-lists API', async () => {
        const cmd = getRegistry().get('zhihu/hot');
        expect(cmd?.func).toBeTypeOf('function');
        const goto = vi.fn().mockResolvedValue(undefined);
        const evaluate = vi.fn().mockResolvedValue({
            data: [
                {
                    card_id: 'Q_123456',
                    detail_text: '100 万热度',
                    target: {
                        id: 123456,
                        type: 'question',
                        title: 'Test Question',
                        answer_count: 50,
                        url: 'https://api.zhihu.com/questions/123456',
                    },
                },
                {
                    card_id: 'A_789012',
                    detail_text: '50 万热度',
                    target: {
                        id: 789012,
                        type: 'article',
                        title: 'Test Article',
                        answer_count: 10,
                    },
                },
            ],
        });
        const page = { goto, evaluate };
        const res = await cmd.func(page, { limit: 5 });
        expect(res).toEqual([
            {
                rank: 1,
                title: 'Test Question',
                heat: '100 万热度',
                answers: 50,
                url: 'https://www.zhihu.com/question/123456',
            },
            {
                rank: 2,
                title: 'Test Article',
                heat: '50 万热度',
                answers: 10,
                url: 'https://zhuanlan.zhihu.com/p/789012',
            },
        ]);
        expect(goto).toHaveBeenCalledWith('https://www.zhihu.com');
    });

    it('handles auth errors', async () => {
        const cmd = getRegistry().get('zhihu/hot');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({ __httpError: 401 }),
        };
        await expect(cmd.func(page, {})).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('handles fetch errors', async () => {
        const cmd = getRegistry().get('zhihu/hot');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({ __fetchError: 'Network failure' }),
        };
        await expect(cmd.func(page, {})).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('handles empty results', async () => {
        const cmd = getRegistry().get('zhihu/hot');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({ data: [] }),
        };
        await expect(cmd.func(page, {})).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('validates limit range', () => {
        expect(__test__.parseHotLimit(10)).toBe(10);
        expect(() => __test__.parseHotLimit(0)).toThrow(ArgumentError);
        expect(() => __test__.parseHotLimit(100)).toThrow(ArgumentError);
    });
});
