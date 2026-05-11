import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './search.js';
import './recent.js';

describe('gov-law commands', () => {
    const search = getRegistry().get('gov-law/search');
    const recent = getRegistry().get('gov-law/recent');

    it('registers both commands as public browser commands', () => {
        expect(search).toBeDefined();
        expect(recent).toBeDefined();
        expect(search.strategy).toBe('public');
        expect(recent.strategy).toBe('public');
        expect(search.browser).toBe(true);
        expect(recent.browser).toBe(true);
    });

    it('rejects empty search queries before browser navigation', async () => {
        const page = { goto: vi.fn() };
        await expect(search.func(page, { query: '   ' })).rejects.toMatchObject({
            name: 'ArgumentError',
            code: 'ARGUMENT',
        });
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('throws a descriptive error when Vue Router is unavailable', async () => {
        const page = {
            goto: vi.fn(),
            wait: vi.fn(),
            evaluate: vi.fn().mockResolvedValue(false),
        };
        await expect(recent.func(page, { limit: 3 })).rejects.toMatchObject({
            name: 'CliError',
            code: 'FRAMEWORK_CHANGED',
        });
    });
});
