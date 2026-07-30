import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './create-pin.js';

vi.mock('node:fs', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        statSync: vi.fn((p, _opts) => {
            if (String(p).includes('missing')) return undefined;
            return { isFile: () => true };
        }),
        readFileSync: vi.fn(() => Buffer.from([0xff, 0xd8, 0xff, 0xd9])),
    };
});

vi.mock('node:path', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        resolve: vi.fn((p) => `/abs/${p}`),
        extname: vi.fn((p) => {
            const m = String(p).match(/\.[^.]+$/);
            return m ? m[0] : '';
        }),
        basename: vi.fn((p) => String(p).split('/').pop() || ''),
    };
});

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
        setFileInput: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

describe('pinterest create-pin command', () => {
    const getCommand = () => getRegistry().get('pinterest/create-pin');

    it('falls back to DataTransfer upload when CDP file input is not allowed', async () => {
        const command = getCommand();
        const setFileInput = vi.fn().mockRejectedValue(new Error('Chrome Not allowed'));
        const page = makePage([
            { loggedIn: true, hasCreateSurface: true },
            { ok: true, selector: 'input[type="file"]' },
            { ok: true, count: 1 },
            { ok: true, count: 1 },
            { ok: true, field: 'title' },
            { ok: true, field: 'description' },
            { ok: true, board: 'Ideas' },
            { ok: true, label: 'Publish' },
            { ok: true, url: 'https://www.pinterest.com/pin/123456789/' },
        ], { setFileInput });

        const result = await command.func(page, {
            image: 'ant.jpg',
            board: 'Ideas',
            title: 'Life Cycle of an Ant',
            description: 'Ant metamorphosis diagram.',
            timeout: 30,
        });

        const evaluateCalls = page.evaluate.mock.calls.map((args) => String(args[0]));
        expect(setFileInput).toHaveBeenCalledWith(['/abs/ant.jpg'], 'input[type="file"]');
        expect(evaluateCalls.some((code) => code.includes('new DataTransfer()'))).toBe(true);
        expect(evaluateCalls.some((code) => code.includes('Could not assign files to input'))).toBe(true);
        expect(result).toEqual([{
            status: 'published',
            board: 'Ideas',
            title: 'Life Cycle of an Ant',
            url: 'https://www.pinterest.com/pin/123456789/',
        }]);
    });
});
