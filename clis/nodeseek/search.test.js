import { getRegistry } from '@jackwener/opencli/registry';
import { describe, expect, it } from 'vitest';
import './search.js';

describe('nodeseek search', () => {
    it('registers search with a positional query and the shared list columns', () => {
        const command = getRegistry().get('nodeseek/search');
        expect(command).toBeDefined();
        expect(command?.args?.[0]).toMatchObject({ name: 'query', positional: true, required: true });
        expect(command?.columns).toEqual(['post_id', 'title', 'category', 'author', 'time', 'link']);
    });
});
