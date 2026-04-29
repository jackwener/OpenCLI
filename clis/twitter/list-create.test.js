import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './list-create.js';

describe('twitter list-create registration', () => {
    it('registers the list-create command with the expected shape', () => {
        const cmd = getRegistry().get('twitter/list-create');
        expect(cmd?.func).toBeTypeOf('function');
        expect(cmd?.columns).toEqual(['id', 'name', 'description', 'mode', 'status']);
        const nameArg = cmd?.args?.find((a) => a.name === 'name');
        expect(nameArg).toBeTruthy();
        expect(nameArg?.required).toBe(true);
        expect(nameArg?.positional).toBe(true);
        const modeArg = cmd?.args?.find((a) => a.name === 'mode');
        expect(modeArg?.default).toBe('public');
        const descArg = cmd?.args?.find((a) => a.name === 'description');
        expect(descArg?.default).toBe('');
    });

    it('rejects empty name', async () => {
        const cmd = getRegistry().get('twitter/list-create');
        await expect(cmd.func({}, { name: '   ' })).rejects.toThrow(/List name is required/);
    });

    it('rejects names over 25 chars', async () => {
        const cmd = getRegistry().get('twitter/list-create');
        await expect(cmd.func({}, { name: 'x'.repeat(26) })).rejects.toThrow(/List name too long/);
    });

    it('rejects invalid mode', async () => {
        const cmd = getRegistry().get('twitter/list-create');
        await expect(cmd.func({}, { name: 'ok', mode: 'secret' })).rejects.toThrow(/Invalid mode/);
    });
});
