import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './search.js';
import './recent.js';

describe('gov-policy commands', () => {
    const search = getRegistry().get('gov-policy/search');
    const recent = getRegistry().get('gov-policy/recent');

    it('registers both commands as public browser commands', () => {
        expect(search).toBeDefined();
        expect(recent).toBeDefined();
        expect(search.browser).toBe(true);
        expect(recent.browser).toBe(true);
        expect(search.strategy).toBe('public');
        expect(recent.strategy).toBe('public');
    });

    it('rejects empty search queries before browser navigation', async () => {
        const page = { goto: vi.fn() };
        await expect(search.func(page, { query: '   ' })).rejects.toMatchObject({
            name: 'ArgumentError',
            code: 'ARGUMENT',
        });
        expect(page.goto).not.toHaveBeenCalled();
    });
});
