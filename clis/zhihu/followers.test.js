import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { AuthRequiredError, CliError, CommandExecutionError } from '@jackwener/opencli/errors';
import './followers.js';

describe('zhihu followers', () => {
    it('maps a followers list to rows', async () => {
        const cmd = getRegistry().get('zhihu/followers');
        expect(cmd?.func).toBeTypeOf('function');
        const evaluate = vi.fn().mockImplementation(async (js) => {
            expect(js).toContain('/api/v4/members/wen-jie-16-47/followers');
            return {
                data: [
                    { url_token: 'chen-lei-26-17-63', name: 'Nyvo', follower_count: 15 },
                ],
                paging: { is_end: true },
            };
        });
        await expect(cmd.func({ goto: vi.fn().mockResolvedValue(undefined), evaluate }, { user: 'wen-jie-16-47', limit: 1 })).resolves.toEqual([
            { rank: 1, name: 'Nyvo', url_token: 'chen-lei-26-17-63', headline: '', followers: 15, url: 'https://www.zhihu.com/people/chen-lei-26-17-63' },
        ]);
    });

    it('maps 403 to AuthRequiredError', async () => {
        const cmd = getRegistry().get('zhihu/followers');
        const page = { goto: vi.fn().mockResolvedValue(undefined), evaluate: vi.fn().mockResolvedValue({ __httpError: 403 }) };
        await expect(cmd.func(page, { user: 'foo', limit: 1 })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('fails typed on malformed follower rows', async () => {
        const cmd = getRegistry().get('zhihu/followers');
        const page = { goto: vi.fn().mockResolvedValue(undefined), evaluate: vi.fn().mockResolvedValue({ data: [{ url_token: 'no-name' }], paging: { is_end: true } }) };
        await expect(cmd.func(page, { user: 'foo', limit: 1 })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('rejects invalid limits before navigation', async () => {
        const cmd = getRegistry().get('zhihu/followers');
        const page = { goto: vi.fn(), evaluate: vi.fn() };
        await expect(cmd.func(page, { user: 'foo', limit: 99999 })).rejects.toBeInstanceOf(CliError);
        expect(page.goto).not.toHaveBeenCalled();
    });
});
