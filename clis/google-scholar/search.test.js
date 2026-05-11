import { describe, expect, it, vi } from 'vitest';
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
            evaluate: vi.fn().mockResolvedValue([]),
        };

        await command.func(page, { query: 'transformer' });

        const script = page.evaluate.mock.calls[0][0];
        expect(script).toContain("document.querySelectorAll('.gs_r.gs_or.gs_scl')");
        expect(script).not.toContain(".gs_r.gs_or.gs_scl, .gs_ri");
        expect(script).toContain("const container = el.querySelector('.gs_ri') || el");
    });
});
