import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './movie-hot.js';

describe('douban movie-hot command', () => {
    it('exposes only fields available from the chart page', () => {
        const command = getRegistry().get('douban/movie-hot');

        expect(command?.columns).toEqual(['rank', 'id', 'title', 'rating', 'votes', 'year', 'url']);
        expect(command?.columns).not.toContain('director');
        expect(command?.columns).not.toContain('region');
        expect(command?.columns).not.toContain('quote');
    });
});
