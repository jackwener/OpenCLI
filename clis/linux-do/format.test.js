import { describe, expect, it } from 'vitest';
import { stripHtml, toLocalTime } from './format.js';

describe('linux-do format helpers', () => {
    it('normalizes empty, invalid, and valid timestamps', () => {
        const validInput = '2025-04-05T10:00:00.000Z';
        expect(toLocalTime('')).toBe('');
        expect(toLocalTime(null)).toBe('');
        expect(toLocalTime(undefined)).toBe('');
        expect(toLocalTime('not-a-date')).toBe('not-a-date');
        expect(toLocalTime(validInput)).not.toBe(validInput);
        expect(toLocalTime(validInput)).toBe(new Date(validInput).toLocaleString());
    });

    it('strips HTML blocks and collapses whitespace', () => {
        expect(stripHtml('<p>Hello</p><div>world</div><br/>again')).toBe('Hello world again');
        expect(stripHtml('  one   <br>   two\nthree  ')).toBe('one two three');
    });

    it('decodes named and numeric entities', () => {
        expect(stripHtml('&nbsp;&amp;&lt;&gt;&quot;')).toBe('&<>"');
        expect(stripHtml('&#65; &#x42;')).toBe('A B');
    });

    it('drops invalid numeric code points instead of throwing', () => {
        expect(stripHtml('a &#9999999999; b')).toBe('a b');
    });

    it('coerces falsy input to an empty string', () => {
        expect(stripHtml('')).toBe('');
        expect(stripHtml(null)).toBe('');
        expect(stripHtml(undefined)).toBe('');
    });
});
