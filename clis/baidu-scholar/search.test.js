import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './search.js';

describe('baidu-scholar search command', () => {
    const command = getRegistry().get('baidu-scholar/search');

    it('registers as a public browser command', () => {
        expect(command).toBeDefined();
        expect(command.site).toBe('baidu-scholar');
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
