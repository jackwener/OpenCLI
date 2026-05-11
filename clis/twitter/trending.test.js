import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './trending.js';

describe('twitter trending', () => {
    it('registers the trending command with rank/topic/category columns only', () => {
        const cmd = getRegistry().get('twitter/trending');
        expect(cmd).toBeDefined();
        // The `tweets` column was permanently "N/A" because X removed the post-count
        // caption from the trend cell; we drop it rather than keep returning a
        // silent-wrong sentinel for every row. Guard against re-introduction.
        expect(cmd.columns).toEqual(['rank', 'topic', 'category']);
        expect(cmd.columns).not.toContain('tweets');
    });
});
