import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './comments.js';

describe('douban comments command', () => {
    it('registers short comments as a browser command that handles its own navigation', () => {
        const command = getRegistry().get('douban/comments');
        expect(command).toBeDefined();
        expect(command?.browser).toBe(true);
        expect(command?.navigateBefore).toBe(false);
        expect(command?.args.map((arg) => arg.name)).toEqual(['id', 'type', 'limit', 'sort']);
        expect(command?.columns).toContain('content');
    });
});
