import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './subject.js';

describe('douban subject command', () => {
    it('skips default pre-navigation because the adapter handles subject navigation itself', () => {
        const command = getRegistry().get('douban/subject');
        expect(command).toBeDefined();
        expect(command?.navigateBefore).toBe(false);
    });

    it('accepts music subject type', () => {
        const command = getRegistry().get('douban/subject');
        const typeArg = command?.args.find((arg) => arg.name === 'type');
        expect(typeArg?.choices).toEqual(['movie', 'book', 'music']);
    });
});
