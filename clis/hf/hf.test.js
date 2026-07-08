import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './top.js';
import './paper.js';

describe('hf adapter registry contracts', () => {
    it('declares hf top columns so paper ids round-trip into hf paper', () => {
        const top = getRegistry().get('hf/top');
        const paper = getRegistry().get('hf/paper');

        expect(top).toBeDefined();
        expect(paper).toBeDefined();
        expect(top.columns).toEqual(['rank', 'id', 'title', 'upvotes', 'authors']);
        expect(paper.columns).toContain('id');
    });
});
