import { describe, expect, it, vi } from 'vitest';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { smzdmFavoriteCommand } from './favorite.js';

describe('smzdm/favorite', () => {
    it('declares write access and a status/message result shape', () => {
        expect(smzdmFavoriteCommand.access).toBe('write');
        expect(smzdmFavoriteCommand.columns).toEqual(['status', 'message']);
        expect(smzdmFavoriteCommand.strategy).toBe('ui');
    });

    it('requires a browser session', async () => {
        await expect(smzdmFavoriteCommand.func(null, { deal: '174854494' })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('rejects an off-domain deal argument before navigation', async () => {
        const page = { goto: vi.fn(), evaluate: vi.fn(), wait: vi.fn() };
        await expect(smzdmFavoriteCommand.func(page, { deal: 'https://evil.example/p/1/' })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('maps a confirmed favorite into a success row', async () => {
        const page = {
            goto: vi.fn(),
            wait: vi.fn(),
            evaluate: vi.fn().mockResolvedValue({ ok: true, message: 'Deal favorited.' }),
        };
        const rows = await smzdmFavoriteCommand.func(page, { deal: '174854494' });
        expect(rows).toEqual([{ status: 'success', message: 'Deal favorited.' }]);
        expect(page.goto).toHaveBeenCalledWith('https://www.smzdm.com/p/174854494/');
    });

    it('maps a failed favorite into a failed row', async () => {
        const page = {
            goto: vi.fn(),
            wait: vi.fn(),
            evaluate: vi.fn().mockResolvedValue({ ok: false, message: 'not logged in' }),
        };
        const rows = await smzdmFavoriteCommand.func(page, { deal: '174854494' });
        expect(rows).toEqual([{ status: 'failed', message: 'not logged in' }]);
    });
});
