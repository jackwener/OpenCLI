import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './search.js';
describe('cnki search command', () => {
    const command = getRegistry().get('cnki/search');
    it('registers the command', () => {
        expect(command).toBeDefined();
        expect(command.site).toBe('cnki');
        expect(command.name).toBe('search');
    });
    it('rejects empty queries before browser navigation', async () => {
        const page = { goto: async () => undefined };
        await expect(command.func(page, { query: '   ' })).rejects.toMatchObject({
            name: 'ArgumentError',
            code: 'ARGUMENT',
        });
    });
});
