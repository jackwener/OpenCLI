import { describe, expect, it } from 'vitest';
import { stripHtml } from './text.js';

describe('zhihu text helpers', () => {
    it('strips tags and decodes named entities in flat mode', () => {
        expect(stripHtml('<em>Codex</em>&nbsp;&amp;&nbsp;&lt;CLI&gt;')).toBe('Codex & <CLI>');
    });

    it('decodes decimal and hexadecimal numeric entities', () => {
        expect(stripHtml('&#34;中文&#34; &#x26; &#39;test&#39;')).toBe('"中文" & \'test\'');
    });

    it('keeps invalid numeric entities unchanged', () => {
        expect(stripHtml('bad &#9999999999; entity')).toBe('bad &#9999999999; entity');
    });

    it('keeps list excerpts flat by default', () => {
        expect(stripHtml('<p>first</p><br><p>second</p>')).toBe('firstsecond');
    });

    it('preserves block breaks when requested', () => {
        expect(stripHtml('<p>first</p><br><p>second</p>', { preserveBlocks: true })).toBe('first\n\nsecond');
    });
});
