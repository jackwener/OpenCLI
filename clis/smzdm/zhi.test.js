import { describe, expect, it, vi } from 'vitest';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { smzdmZhiCommand } from './zhi.js';

describe('smzdm/zhi', () => {
    it('declares write access and a status/vote/message result shape', () => {
        expect(smzdmZhiCommand.access).toBe('write');
        expect(smzdmZhiCommand.columns).toEqual(['status', 'vote', 'message']);
        expect(smzdmZhiCommand.strategy).toBe('ui');
    });

    it('requires a browser session', async () => {
        await expect(smzdmZhiCommand.func(null, { deal: '174854494' })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('rejects an off-domain deal argument before navigation', async () => {
        const page = { goto: vi.fn(), evaluate: vi.fn(), wait: vi.fn() };
        await expect(smzdmZhiCommand.func(page, { deal: 'https://evil.example/p/1/' })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('labels the vote 值 by default and 不值 with --down', async () => {
        const page = {
            goto: vi.fn(),
            wait: vi.fn(),
            evaluate: vi.fn().mockResolvedValue({ ok: true, message: 'Rated 值.' }),
        };
        const up = await smzdmZhiCommand.func(page, { deal: '174854494' });
        expect(up).toEqual([{ status: 'success', vote: '值', message: 'Rated 值.' }]);

        page.evaluate.mockResolvedValue({ ok: true, message: 'Rated 不值.' });
        const down = await smzdmZhiCommand.func(page, { deal: '174854494', down: true });
        expect(down[0].vote).toBe('不值');
    });

    it('maps an already-rated deal into a success row', async () => {
        const page = {
            goto: vi.fn(),
            wait: vi.fn(),
            evaluate: vi.fn().mockResolvedValue({ ok: true, message: 'Deal is already rated by this account.' }),
        };
        const rows = await smzdmZhiCommand.func(page, { deal: '174854494' });
        expect(rows[0].status).toBe('success');
    });
});
