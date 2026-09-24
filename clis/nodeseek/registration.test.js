import { getRegistry } from '@jackwener/opencli/registry';
import { describe, expect, it } from 'vitest';
import './categories.js';
import './me.js';

describe('nodeseek adapter registration', () => {
    it('registers categories with the expected board count', async () => {
        const command = getRegistry().get('nodeseek/categories');
        expect(command).toBeDefined();
        expect(command?.columns).toEqual(['slug', 'name', 'url']);
        const rows = await command.func({});
        expect(rows).toHaveLength(13);
        expect(rows[0]).toMatchObject({ slug: 'daily', url: 'https://www.nodeseek.com/categories/daily' });
    });

    it('registers me as a cookie-strategy browser command', () => {
        const command = getRegistry().get('nodeseek/me');
        expect(command).toBeDefined();
        expect(command?.columns).toContain('coin');
        expect(command?.columns).toContain('nComment');
    });
});
