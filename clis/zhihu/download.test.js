import { describe, expect, it } from 'vitest';
import TurndownService from 'turndown';
describe('article markdown conversion', () => {
    it('renders ordered lists with the original list item content', () => {
        const html = '<ol><li>First item</li><li>Second item</li></ol>';
        const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-' });
        const md = td.turndown(html);
        expect(md).toMatch(/1\.\s+First item/);
        expect(md).toMatch(/2\.\s+Second item/);
        expect(md).not.toContain('$1');
    });
});
