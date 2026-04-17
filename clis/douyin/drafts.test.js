import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './drafts.js';
describe('douyin drafts registration', () => {
    it('registers the drafts command', () => {
        const registry = getRegistry();
        const values = [...registry.values()];
        const cmd = values.find(c => c.site === 'douyin' && c.name === 'drafts');
        expect(cmd).toBeDefined();
    });
});
