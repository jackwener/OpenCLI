import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './list-remove.js';

describe('twitter list-remove registration', () => {
    it('registers the list-remove command with the expected shape', () => {
        const cmd = getRegistry().get('twitter/list-remove');
        expect(cmd?.func).toBeTypeOf('function');
        expect(cmd?.columns).toEqual(['listId', 'username', 'userId', 'status', 'message']);
        const listIdArg = cmd?.args?.find((a) => a.name === 'listId');
        expect(listIdArg).toBeTruthy();
        expect(listIdArg?.required).toBe(true);
    });

    it('keeps the x.com root navigation before pre-target GraphQL calls', async () => {
        const cmd = getRegistry().get('twitter/list-remove');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            getCookies: vi.fn().mockResolvedValue([{ name: 'ct0', value: 'token' }]),
            evaluate: vi.fn()
                .mockResolvedValueOnce(null) // UserByScreenName queryId fallback
                .mockResolvedValueOnce('user-1')
                .mockResolvedValueOnce(null) // ListsManagement queryId fallback
                .mockResolvedValueOnce({}),
        };

        await expect(cmd.func(page, { listId: '123', username: 'alice' }))
            .rejects
            .toThrow(/List 123 not found/);
        expect(page.goto).toHaveBeenCalledWith('https://x.com');
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.wait).toHaveBeenCalledWith(3);
        expect(page.getCookies).toHaveBeenCalledWith({ url: 'https://x.com' });
    });
});
