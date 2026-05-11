import { describe, expect, it, vi } from 'vitest';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './profile.js';

describe('google-scholar profile command', () => {
    const command = getRegistry().get('google-scholar/profile');

    it('registers as a public browser command', () => {
        expect(command).toBeDefined();
        expect(command.site).toBe('google-scholar');
        expect(command.strategy).toBe('public');
        expect(command.browser).toBe(true);
    });

    it('rejects empty author before browser navigation', async () => {
        const page = { goto: vi.fn() };
        await expect(command.func(page, { author: '   ' })).rejects.toMatchObject({
            name: 'ArgumentError',
            code: 'ARGUMENT',
        });
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('throws when author search does not resolve to a profile', async () => {
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValueOnce(false),
        };
        await expect(command.func(page, { author: 'missing author' })).rejects.toThrow(CommandExecutionError);
    });

    it('throws when the loaded profile has no papers', async () => {
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValueOnce({
                name: 'Author Name',
                affiliation: 'Org',
                citations: '0',
                hIndex: '0',
                i10Index: '0',
                papers: [],
            }),
        };
        await expect(command.func(page, { author: 'JicYPdAAAAAJ' })).rejects.toThrow(CommandExecutionError);
    });
});
