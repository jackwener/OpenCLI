import { describe, expect, it, vi } from 'vitest';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './cite.js';

describe('google-scholar cite command', () => {
    const command = getRegistry().get('google-scholar/cite');

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

    it('throws when the requested search result index does not exist', async () => {
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValueOnce({ ok: false, reason: 'result not found at index 2' }),
        };
        await expect(command.func(page, { query: 'test', index: 2 })).rejects.toThrow(CommandExecutionError);
    });

    it('looks up the requested citation style instead of only locking BibTeX', async () => {
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn()
                .mockResolvedValueOnce({ ok: true, title: 'Paper Title' })
                .mockResolvedValueOnce('https://example.com/refworks')
                .mockResolvedValueOnce('RefWorks citation body'),
        };
        const result = await command.func(page, { query: 'test', style: 'refworks' });
        expect(result).toEqual([{ title: 'Paper Title', format: 'refworks', citation: 'RefWorks citation body' }]);
        expect(page.evaluate.mock.calls[1][0]).toContain('RefWorks');
    });
});
