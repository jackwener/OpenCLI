import { describe, expect, it, vi } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './schedule.js';
import { __test__ } from './schedule.js';

function makePage(evaluateResults = [], overrides = {}) {
    const evaluate = vi.fn();
    for (const result of evaluateResults) {
        evaluate.mockResolvedValueOnce(result);
    }
    evaluate.mockResolvedValue({ ok: true });

    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate,
        insertText: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

describe('twitter schedule command', () => {
    const getCommand = () => getRegistry().get('twitter/schedule');

    it('registers schedule output columns', () => {
        const command = getCommand();
        expect(command?.columns).toEqual(['status', 'message', 'text', 'scheduledFor']);
    });

    it('parses delay-minutes relative to the current time', () => {
        const target = __test__.parseScheduleTarget({ 'delay-minutes': 15 }, new Date('2026-05-24T20:00:00'));

        expect(target).toMatchObject({
            year: 2026,
            month: 5,
            day: 24,
            hour: 20,
            minute: 15,
        });
    });

    it('schedules text through the current compose route', async () => {
        const command = getCommand();
        const page = makePage([
            { ok: true }, // open schedule modal
            { ok: true }, // set schedule controls and confirm
            { ok: true }, // focus composer
            { ok: true }, // verify inserted text
            { ok: true }, // click Schedule
            { ok: true, message: 'Your post will be sent on Thu, May 24, 2096 at 9:30 PM' },
        ]);

        const result = await command.func(page, { text: 'scheduled test', at: '2096-05-24 21:30', 'delay-minutes': '' });

        expect(result).toEqual([{
            status: 'success',
            message: 'Your post will be sent on Thu, May 24, 2096 at 9:30 PM',
            text: 'scheduled test',
            scheduledFor: new Date('2096-05-24T21:30').toISOString(),
        }]);
        expect(page.goto).toHaveBeenCalledWith('https://x.com/compose/post', { waitUntil: 'load', settleMs: 2500 });
        expect(page.insertText).toHaveBeenCalledWith('scheduled test');
    });

    it('fails when schedule modal cannot be opened', async () => {
        const command = getCommand();
        const page = makePage([
            { ok: false, message: 'Could not find the Schedule post button.' },
        ]);

        const result = await command.func(page, { text: 'scheduled test', at: '2096-05-24 21:30', 'delay-minutes': '' });

        expect(result[0]).toMatchObject({
            status: 'failed',
            message: 'Could not find the Schedule post button.',
            text: 'scheduled test',
        });
        expect(page.insertText).not.toHaveBeenCalled();
    });

    it('rejects empty post text', async () => {
        const command = getCommand();
        await expect(command.func(makePage(), { text: '   ' })).rejects.toBeInstanceOf(ArgumentError);
    });
});
