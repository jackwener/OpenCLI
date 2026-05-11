import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './search.js';

describe('wanfang search command', () => {
    const command = getRegistry().get('wanfang/search');

    it('registers as a public browser command', () => {
        expect(command).toBeDefined();
        expect(command.site).toBe('wanfang');
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
});
