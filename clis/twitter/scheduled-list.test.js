import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './scheduled-list.js';

function makePage(evaluateResults = []) {
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

describe('twitter scheduled-list command', () => {
    const getCommand = () => getRegistry().get('twitter/scheduled-list');

    it('registers scheduled list columns', () => {
        const command = getCommand();
        expect(command?.columns).toEqual(['index', 'scheduledFor', 'text']);
    });

    it('opens the scheduled queue and returns rows from the DOM script', async () => {
        const command = getCommand();
        const rows = [{ index: 1, scheduledFor: 'Sun, May 24, 2026 at 9:30 PM', text: 'scheduled test' }];
        const page = makePage([{ ok: true }, { ok: true }, rows]);

        const result = await command.func(page, {});

        expect(result).toEqual(rows);
        expect(page.goto).toHaveBeenCalledWith('https://x.com/compose/post', { waitUntil: 'load', settleMs: 2500 });
        expect(page.wait).toHaveBeenCalledWith({ selector: '[data-testid="unsentButton"]', timeout: 15 });
    });
});
