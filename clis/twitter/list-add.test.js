import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './list-add.js';

describe('twitter list-add registration', () => {
    it('registers the list-add command with the expected shape', () => {
        const cmd = getRegistry().get('twitter/list-add');
        expect(cmd?.func).toBeTypeOf('function');
        expect(cmd?.columns).toEqual(['listId', 'username', 'userId', 'status', 'message']);
        const listIdArg = cmd?.args?.find((a) => a.name === 'listId');
        expect(listIdArg).toBeTruthy();
        expect(listIdArg?.required).toBe(true);
        expect(listIdArg?.positional).toBe(true);
    });
});
