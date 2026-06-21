import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { AuthRequiredError, CliError, CommandExecutionError } from '@jackwener/opencli/errors';
import './following.js';

describe('zhihu following', () => {
    it('maps a followees list to rows', async () => {
        const cmd = getRegistry().get('zhihu/following');
        expect(cmd?.func).toBeTypeOf('function');
        const evaluate = vi.fn().mockImplementation(async (js) => {
            expect(js).toContain('/api/v4/members/wen-jie-16-47/followees');
            return {
                data: [
                    { url_token: 'gaow0007', name: 'GAOW0007', headline: 'ML System', follower_count: 537 },
                    { url_token: 'mfx', name: 'Meng' },
                ],
                paging: { is_end: true },
            };
        });
        await expect(cmd.func({ goto: vi.fn().mockResolvedValue(undefined), evaluate }, { user: 'wen-jie-16-47', limit: 2 })).resolves.toEqual([
            { rank: 1, name: 'GAOW0007', url_token: 'gaow0007', headline: 'ML System', followers: 537, url: 'https://www.zhihu.com/people/gaow0007' },
            { rank: 2, name: 'Meng', url_token: 'mfx', headline: '', followers: 0, url: 'https://www.zhihu.com/people/mfx' },
        ]);
    });

    it('maps 403 to AuthRequiredError', async () => {
        const cmd = getRegistry().get('zhihu/following');
        const page = { goto: vi.fn().mockResolvedValue(undefined), evaluate: vi.fn().mockResolvedValue({ __httpError: 403 }) };
        await expect(cmd.func(page, { user: 'foo', limit: 2 })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('fails typed on malformed following rows', async () => {
        const cmd = getRegistry().get('zhihu/following');
        const page = { goto: vi.fn().mockResolvedValue(undefined), evaluate: vi.fn().mockResolvedValue({ data: [{ name: 'No Token' }], paging: { is_end: true } }) };
        await expect(cmd.func(page, { user: 'foo', limit: 2 })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('rejects invalid limits before navigation', async () => {
        const cmd = getRegistry().get('zhihu/following');
        const page = { goto: vi.fn(), evaluate: vi.fn() };
        await expect(cmd.func(page, { user: 'foo', limit: 0 })).rejects.toBeInstanceOf(CliError);
        expect(page.goto).not.toHaveBeenCalled();
    });
});
