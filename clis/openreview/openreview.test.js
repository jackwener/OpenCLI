import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import {
    absolutePdf,
    coerceInt,
    formatDate,
    noteToRow,
    requireBoundedInt,
    requireForumId,
    requireNonNegativeInt,
    requireProfileId,
} from './utils.js';
import './search.js';
import './venue.js';
import './paper.js';
import './reviews.js';
import './author.js';

const SAMPLE_NOTE = {
    id: 'abc123XYZ_',
    forum: 'abc123XYZ_',
    pdate: 1727524853394,
    cdate: 1727524853394,
    content: {
        title: { value: 'Test Paper Title with   spaces' },
        authors: { value: ['Alice Smith', 'Bob Jones'] },
        authorids: { value: ['~Alice_Smith1', '~Bob_Jones2'] },
        keywords: { value: ['transformer', 'attention'] },
        abstract: { value: 'A long abstract\n  with newlines.' },
        venue: { value: 'ICLR 2024 oral' },
        venueid: { value: 'ICLR.cc/2024/Conference' },
        primary_area: { value: 'foundation models' },
        pdf: { value: '/pdf/abc.pdf' },
    },
};

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('openreview adapter', () => {
    it('noteToRow extracts every wrapped v2 field, joins lists, and builds absolute URLs', () => {
        const row = noteToRow(SAMPLE_NOTE);
        expect(row.id).toBe('abc123XYZ_');
        expect(row.title).toBe('Test Paper Title with spaces');
        expect(row.authors).toBe('Alice Smith, Bob Jones');
        expect(row.keywords).toBe('transformer, attention');
        expect(row.abstract).toBe('A long abstract with newlines.');
        expect(row.venue).toBe('ICLR 2024 oral');
        expect(row.venueid).toBe('ICLR.cc/2024/Conference');
        expect(row.primary_area).toBe('foundation models');
        expect(row.pdf).toBe('https://openreview.net/pdf/abc.pdf');
        expect(row.url).toBe('https://openreview.net/forum?id=abc123XYZ_');
        expect(row.pdate).toBe('2024-09-28');
    });

    it('noteToRow falls back to author IDs when authors field is missing', () => {
        const note = { ...SAMPLE_NOTE, content: { ...SAMPLE_NOTE.content, authors: undefined } };
        expect(noteToRow(note).authors).toBe('Alice Smith, Bob Jones');
    });

    it('coerceInt accepts numeric strings, rejects floats and NaN', () => {
        expect(coerceInt(10)).toBe(10);
        expect(coerceInt('25')).toBe(25);
        expect(Number.isNaN(coerceInt(1.5))).toBe(true);
        expect(Number.isNaN(coerceInt('abc'))).toBe(true);
        expect(Number.isNaN(coerceInt(undefined))).toBe(true);
        expect(Number.isNaN(coerceInt(''))).toBe(true);
    });

    it('requireBoundedInt rejects non-positive, non-integer and over-cap values', () => {
        expect(requireBoundedInt(10, 25, 50)).toBe(10);
        expect(requireBoundedInt(undefined, 25, 50)).toBe(25);
        expect(() => requireBoundedInt(0, 25, 50)).toThrow('positive integer');
        expect(() => requireBoundedInt(1.5, 25, 50)).toThrow('positive integer');
        expect(() => requireBoundedInt(51, 25, 50)).toThrow('<= 50');
        expect(() => requireBoundedInt('abc', 25, 50)).toThrow('positive integer');
    });

    it('requireNonNegativeInt accepts 0 and rejects negatives', () => {
        expect(requireNonNegativeInt(0, 0)).toBe(0);
        expect(requireNonNegativeInt(50, 0)).toBe(50);
        expect(() => requireNonNegativeInt(-1, 0)).toThrow('non-negative integer');
        expect(() => requireNonNegativeInt(1.5, 0)).toThrow('non-negative integer');
    });

    it('requireForumId rejects empty and malformed ids', () => {
        expect(requireForumId('5sRnsubyAK')).toBe('5sRnsubyAK');
        expect(requireForumId('abc-def_12')).toBe('abc-def_12');
        expect(() => requireForumId('')).toThrow('required');
        expect(() => requireForumId('  ')).toThrow('required');
        expect(() => requireForumId('has space')).toThrow('not a valid forum id');
        expect(() => requireForumId('a/b')).toThrow('not a valid forum id');
        expect(() => requireForumId('short')).toThrow('not a valid forum id');
    });

    it('requireProfileId accepts canonical profile ids and rejects malformed input', () => {
        expect(requireProfileId('~Yoshua_Bengio1')).toBe('~Yoshua_Bengio1');
        expect(requireProfileId('~Bo_Liu17')).toBe('~Bo_Liu17');
        expect(requireProfileId('~Geoffrey_Everest_Hinton1')).toBe('~Geoffrey_Everest_Hinton1');
        expect(requireProfileId('~Anne-Christin_Hauschild1')).toBe('~Anne-Christin_Hauschild1');
        expect(requireProfileId('~S.Aruna_Deepthi1')).toBe('~S.Aruna_Deepthi1');
        expect(requireProfileId('~Andrzej_Czyżewski1')).toBe('~Andrzej_Czyżewski1');
        expect(requireProfileId('~August_Bøgh_Rønberg1')).toBe('~August_Bøgh_Rønberg1');
        expect(requireProfileId('~Wagner_Meira_Jr.1')).toBe('~Wagner_Meira_Jr.1');
        expect(() => requireProfileId('')).toThrow('required');
        expect(() => requireProfileId('   ')).toThrow('required');
        // Missing leading tilde.
        expect(() => requireProfileId('Bo_Liu17')).toThrow('not a valid profile id');
        // Missing trailing disambiguator number.
        expect(() => requireProfileId('~Bo_Liu')).toThrow('not a valid profile id');
        // Spaces / non-letter characters break the underscore-joined name.
        expect(() => requireProfileId('~Bo Liu1')).toThrow('not a valid profile id');
        // dblp-style PID must not silently fall through.
        expect(() => requireProfileId('56/953')).toThrow('not a valid profile id');
        expect(() => requireProfileId('~Bo_Liu1?evil=1')).toThrow('not a valid profile id');
        expect(() => requireProfileId('~Bo/Liu1')).toThrow('not a valid profile id');
        expect(() => requireProfileId('~123')).toThrow('not a valid profile id');
    });

    it('formatDate handles ms-since-epoch and rejects invalid input', () => {
        expect(formatDate(1727524853394)).toBe('2024-09-28');
        expect(formatDate(0)).toBe('');
        expect(formatDate(undefined)).toBe('');
        expect(formatDate('abc')).toBe('');
    });

    it('absolutePdf prefixes relative paths and preserves absolute URLs', () => {
        expect(absolutePdf('/pdf/abc.pdf')).toBe('https://openreview.net/pdf/abc.pdf');
        expect(absolutePdf('http://arxiv.org/pdf/1.pdf')).toBe('http://arxiv.org/pdf/1.pdf');
        expect(absolutePdf('https://example.com/x.pdf')).toBe('https://example.com/x.pdf');
        expect(absolutePdf('')).toBe('');
        expect(absolutePdf(undefined)).toBe('');
    });

    it('venue applies offset to the rank column so paginated results stay ordered', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ notes: [SAMPLE_NOTE, SAMPLE_NOTE] }), { status: 200 })));
        const venue = getRegistry().get('openreview/venue');
        const rows = await venue.func({ venue: 'ICLR 2024 oral', limit: 2, offset: 50 });
        expect(rows[0].rank).toBe(51);
        expect(rows[1].rank).toBe(52);
    });

});
