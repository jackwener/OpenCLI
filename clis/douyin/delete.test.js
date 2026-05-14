import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './delete.js';

describe('douyin delete registration', () => {
    it('registers the delete command', () => {
        const registry = getRegistry();
        const values = [...registry.values()];
        const cmd = values.find(c => c.site === 'douyin' && c.name === 'delete');
        expect(cmd).toBeDefined();
    });

    it('uses work_list id/index matching instead of title matching for fallback deletion', () => {
        const source = readFileSync(new URL('./delete.js', import.meta.url), 'utf8');
        expect(source).toContain('target_not_unique');
        expect(source).toContain("String(entry.aweme_id || '') === targetId");
        expect(source).toContain('cards[target.index]');
        expect(source).not.toContain('text.includes(target.title)');
    });
});
