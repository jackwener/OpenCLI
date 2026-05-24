import { describe, expect, it, vi } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './scheduled-delete.js';

function makePage(evaluateResults = [{ ok: true }, { ok: true }, { ok: true, message: 'Scheduled post deleted.' }]) {
    const evaluate = vi.fn();
    for (const result of evaluateResults) {
        evaluate.mockResolvedValueOnce(result);
    }
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate,
    };
}

describe('twitter scheduled-delete command', () => {
    const getCommand = () => getRegistry().get('twitter/scheduled-delete');

    it('registers scheduled delete columns', () => {
        const command = getCommand();
        expect(command?.columns).toEqual(['status', 'message', 'match']);
    });

    it('deletes a scheduled post by text fragment', async () => {
        const command = getCommand();
        const page = makePage();

        const result = await command.func(page, { match: 'scheduled test' });

        expect(result).toEqual([{ status: 'success', message: 'Scheduled post deleted.', match: 'scheduled test' }]);
        expect(page.goto).toHaveBeenCalledWith('https://x.com/compose/post', { waitUntil: 'load', settleMs: 2500 });
        expect(page.evaluate.mock.calls[2][0]).toContain('scheduled test');
    });

    it('returns failed when the DOM script cannot delete the scheduled post', async () => {
        const command = getCommand();
        const page = makePage([
            { ok: true },
            { ok: true },
            { ok: false, message: 'Could not find a scheduled post matching the text fragment.' },
        ]);

        const result = await command.func(page, { match: 'missing' });

        expect(result).toEqual([{
            status: 'failed',
            message: 'Could not find a scheduled post matching the text fragment.',
            match: 'missing',
        }]);
    });

    it('rejects an empty text fragment', async () => {
        const command = getCommand();
        await expect(command.func(makePage(), { match: '   ' })).rejects.toBeInstanceOf(ArgumentError);
    });
});
