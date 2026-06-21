import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { AuthRequiredError, CliError, CommandExecutionError } from '@jackwener/opencli/errors';
import './pins.js';

describe('zhihu pins', () => {
    it('maps a pins list to rows', async () => {
        const cmd = getRegistry().get('zhihu/pins');
        expect(cmd?.func).toBeTypeOf('function');
        const evaluate = vi.fn().mockImplementation(async (js) => {
            expect(js).toContain('/api/v4/members/wen-jie-16-47/pins');
            return {
                data: [
                    { id: 'pin1', excerpt_title: 'About CrabClaw', content: [{ type: 'text' }], like_count: 4, comment_count: 1, repin_count: 2, created: 1772468804 },
                    { id: 'pin2', excerpt_title: 'second', reaction_count: 9, updated: 1772468999 },
                ],
                paging: { is_end: true },
            };
        });
        await expect(cmd.func({ goto: vi.fn().mockResolvedValue(undefined), evaluate }, { user: 'wen-jie-16-47', limit: 2 })).resolves.toEqual([
            { rank: 1, excerpt: 'About CrabClaw', type: 'text', likes: 4, comments: 1, reposts: 2, created: 1772468804, url: 'https://www.zhihu.com/pin/pin1' },
            { rank: 2, excerpt: 'second', type: '', likes: 9, comments: 0, reposts: 0, created: 1772468999, url: 'https://www.zhihu.com/pin/pin2' },
        ]);
    });

    it('maps 403 to AuthRequiredError', async () => {
        const cmd = getRegistry().get('zhihu/pins');
        const page = { goto: vi.fn().mockResolvedValue(undefined), evaluate: vi.fn().mockResolvedValue({ __httpError: 403 }) };
        await expect(cmd.func(page, { user: 'foo', limit: 2 })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('fails typed on malformed pin identity rows', async () => {
        const cmd = getRegistry().get('zhihu/pins');
        const page = { goto: vi.fn().mockResolvedValue(undefined), evaluate: vi.fn().mockResolvedValue({ data: [{ id: 'pin1' }], paging: { is_end: true } }) };
        await expect(cmd.func(page, { user: 'foo', limit: 2 })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('rejects invalid limits before navigation', async () => {
        const cmd = getRegistry().get('zhihu/pins');
        const page = { goto: vi.fn(), evaluate: vi.fn() };
        await expect(cmd.func(page, { user: 'foo', limit: 0 })).rejects.toBeInstanceOf(CliError);
        expect(page.goto).not.toHaveBeenCalled();
    });
});
