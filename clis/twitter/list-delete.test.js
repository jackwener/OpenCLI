import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { buildListDeleteRow } from './list-delete.js';

describe('twitter list-delete registration', () => {
    it('registers the list-delete command with explicit confirmation', () => {
        const cmd = getRegistry().get('twitter/list-delete');
        expect(cmd?.func).toBeTypeOf('function');
        expect(cmd?.columns).toEqual(['listId', 'name', 'members', 'status', 'message']);
        expect(cmd?.args?.find((a) => a.name === 'confirm')?.default).toBe(false);
        expect(cmd?.args?.find((a) => a.name === 'timeout')?.default).toBe(300);
    });

    it('rejects deletion when confirm is not true before navigation', async () => {
        const cmd = getRegistry().get('twitter/list-delete');
        const page = {
            goto: vi.fn(),
            wait: vi.fn(),
            getCookies: vi.fn(),
            evaluate: vi.fn(),
        };

        await expect(cmd.func(page, { listId: '123', confirm: false })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('builds the success row from the pre-delete list payload', () => {
        const row = buildListDeleteRow({
            listId: '123',
            targetList: { name: 'AI Builders', members: '50' },
        });

        expect(row).toEqual({
            listId: '123',
            name: 'AI Builders',
            members: '50',
            status: 'success',
            message: 'Deleted list AI Builders (50 members)',
        });
    });
});
