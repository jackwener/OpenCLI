import { describe, expect, it } from 'vitest';
import { normalizeCount, normalizeUnixSeconds, stripHtml } from './answer-normalize.js';

describe('zhihu answer normalize helpers', () => {
    it('strips answer HTML through block-preserving text normalization', () => {
        expect(stripHtml('<p>hi&nbsp;there &amp; you</p><p>second</p>')).toBe('hi there & you\n\nsecond');
        expect(stripHtml('a<br>b<br/>c')).toBe('a\nb\nc');
        expect(stripHtml('&#34;中文&#34; &#x26; &#39;test&#39;')).toBe('"中文" & \'test\'');
    });

    it('keeps invalid numeric entities unchanged', () => {
        expect(stripHtml('bad &#9999999999; entity')).toBe('bad &#9999999999; entity');
    });

    it('normalizes counts to non-negative integers', () => {
        expect(normalizeCount(0)).toBe(0);
        expect(normalizeCount(12)).toBe(12);
        for (const value of [-1, 1.5, Number.NaN, Infinity, '3', null, undefined, {}, []]) {
            expect(normalizeCount(value)).toBe(0);
        }
    });

    it('normalizes positive finite unix seconds to ISO timestamps', () => {
        expect(normalizeUnixSeconds(1700000000)).toBe('2023-11-14T22:13:20.000Z');
        for (const value of [0, -1, Number.NaN, Infinity, -Infinity, '1700000000', null, undefined]) {
            expect(normalizeUnixSeconds(value)).toBe('');
        }
    });
});
