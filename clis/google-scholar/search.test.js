import { describe, expect, it, vi } from 'vitest';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './search.js';

describe('google-scholar search command', () => {
    const command = getRegistry().get('google-scholar/search');

    it('registers as a public browser command', () => {
        expect(command).toBeDefined();
        expect(command.site).toBe('google-scholar');
        expect(command.strategy).toBe('public');
        expect(command.browser).toBe(true);
    });

    it('rejects empty queries before browser navigation', async () => {
        const page = { goto: vi.fn() };
        await expect(command.func(page, { query: '   ' })).rejects.toMatchObject({
            name: 'ArgumentError',
            code: 'ARGUMENT',
        });
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('locks dedup to outer Scholar result cards while preserving inner content extraction', async () => {
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({ items: [{ rank: 1, title: 'Paper' }], resultCount: 1 }),
        };

        const rows = await command.func(page, { query: 'transformer' });

        const script = page.evaluate.mock.calls[0][0];
        expect(script).toContain("document.querySelectorAll('.gs_r.gs_or.gs_scl')");
        expect(script).not.toContain(".gs_r.gs_or.gs_scl, .gs_ri");
        expect(script).toContain("const container = el.querySelector('.gs_ri') || el");
        expect(script).toContain('return { items: results, resultCount: resultCards.length }');
        expect(rows).toEqual([{ rank: 1, title: 'Paper' }]);
    });

    it('throws typed empty when Scholar returns no result cards', async () => {
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({ items: [], resultCount: 0 }),
        };

        await expect(command.func(page, { query: 'no results expected' })).rejects.toThrow(EmptyResultError);
    });

    it('throws command execution when result cards exist but parser extracts no rows', async () => {
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({ items: [], resultCount: 2 }),
        };

        await expect(command.func(page, { query: 'parser drift' })).rejects.toThrow(CommandExecutionError);
    });

    it('throws command execution for malformed evaluate payloads instead of treating them as empty', async () => {
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({ items: { rank: 1 }, resultCount: 1 }),
        };

        await expect(command.func(page, { query: 'bad payload' })).rejects.toThrow(CommandExecutionError);
    });
});
