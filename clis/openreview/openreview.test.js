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
    it('registers all five commands with the expected columns', () => {
        const search = getRegistry().get('openreview/search');
        const venue = getRegistry().get('openreview/venue');
        const paper = getRegistry().get('openreview/paper');
        const reviews = getRegistry().get('openreview/reviews');
        const author = getRegistry().get('openreview/author');

        expect(search).toBeDefined();
        expect(venue).toBeDefined();
        expect(paper).toBeDefined();
        expect(reviews).toBeDefined();
        expect(author).toBeDefined();

        expect(search.columns).toEqual(['rank', 'id', 'title', 'authors', 'venue', 'pdate', 'url']);
        expect(venue.columns).toEqual(['rank', 'id', 'title', 'authors', 'keywords', 'primary_area', 'pdate', 'pdf', 'url']);
        expect(paper.columns).toEqual(['id', 'title', 'authors', 'keywords', 'venue', 'venueid', 'primary_area', 'abstract', 'pdate', 'pdf', 'url']);
        expect(reviews.columns).toEqual(['type', 'author', 'rating', 'confidence', 'text']);
        expect(author.columns).toEqual(['rank', 'id', 'title', 'authors', 'venue', 'pdate', 'url']);
    });

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

    it('search throws ArgumentError on empty query', async () => {
        const search = getRegistry().get('openreview/search');
        await expect(search.func({ query: '', limit: 10 })).rejects.toMatchObject({ code: 'ARGUMENT' });
        await expect(search.func({ query: '   ', limit: 10 })).rejects.toMatchObject({ code: 'ARGUMENT' });
    });

    it('search throws EmptyResult when API returns no notes', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ notes: [] }), { status: 200 })));
        const search = getRegistry().get('openreview/search');
        await expect(search.func({ query: 'no-such-paper-xyz', limit: 5 })).rejects.toMatchObject({ code: 'EMPTY_RESULT' });
    });

    it('search wraps non-200 responses as CommandExecutionError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 })));
        const search = getRegistry().get('openreview/search');
        await expect(search.func({ query: 'transformer', limit: 5 })).rejects.toMatchObject({ code: 'COMMAND_EXEC' });
    });

    it('search wraps fetch network errors', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
        const search = getRegistry().get('openreview/search');
        await expect(search.func({ query: 'transformer', limit: 5 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('Network failure'),
        });
    });

    it('search wraps malformed JSON', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not-json', { status: 200 })));
        const search = getRegistry().get('openreview/search');
        await expect(search.func({ query: 'transformer', limit: 5 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('Malformed JSON'),
        });
    });

    it('search wraps OpenReview in-band error envelopes as CommandExecutionError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            errors: [{ message: 'bad term' }],
        }), { status: 200 })));
        const search = getRegistry().get('openreview/search');
        await expect(search.func({ query: 'transformer', limit: 5 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('bad term'),
        });
    });

    it('search returns rank-ordered rows with the expected shape', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ notes: [SAMPLE_NOTE, SAMPLE_NOTE] }), { status: 200 })));
        const search = getRegistry().get('openreview/search');
        const rows = await search.func({ query: 'transformer', limit: 5 });
        expect(rows).toHaveLength(2);
        expect(rows[0]).toEqual({
            rank: 1,
            id: 'abc123XYZ_',
            title: 'Test Paper Title with spaces',
            authors: 'Alice Smith, Bob Jones',
            venue: 'ICLR 2024 oral',
            pdate: '2024-09-28',
            url: 'https://openreview.net/forum?id=abc123XYZ_',
        });
        expect(rows[1].rank).toBe(2);
    });

    it('venue dispatches invitation vs venue-text via /-/ heuristic', async () => {
        // Each call must return a fresh Response — bodies can only be read once.
        const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ notes: [SAMPLE_NOTE] }), { status: 200 })));
        vi.stubGlobal('fetch', fetchMock);
        const venue = getRegistry().get('openreview/venue');
        await venue.func({ venue: 'ICLR.cc/2025/Conference/-/Submission', limit: 1, offset: 0 });
        expect(fetchMock.mock.calls[0][0]).toContain('invitation=ICLR.cc');
        await venue.func({ venue: 'ICLR 2024 oral', limit: 1, offset: 0 });
        expect(fetchMock.mock.calls[1][0]).toContain('content.venue=ICLR%202024%20oral');
    });

    it('venue applies offset to the rank column so paginated results stay ordered', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ notes: [SAMPLE_NOTE, SAMPLE_NOTE] }), { status: 200 })));
        const venue = getRegistry().get('openreview/venue');
        const rows = await venue.func({ venue: 'ICLR 2024 oral', limit: 2, offset: 50 });
        expect(rows[0].rank).toBe(51);
        expect(rows[1].rank).toBe(52);
    });

    it('paper rejects invalid ids before calling the network', async () => {
        const paper = getRegistry().get('openreview/paper');
        await expect(paper.func({ id: '' })).rejects.toMatchObject({ code: 'ARGUMENT' });
        await expect(paper.func({ id: 'has space' })).rejects.toMatchObject({ code: 'ARGUMENT' });
    });

    it('paper throws EmptyResult when the note id is unknown', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ notes: [] }), { status: 200 })));
        const paper = getRegistry().get('openreview/paper');
        await expect(paper.func({ id: 'abc123XYZ_' })).rejects.toMatchObject({ code: 'EMPTY_RESULT' });
    });

    it('paper returns a single row with the full abstract intact', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ notes: [SAMPLE_NOTE] }), { status: 200 })));
        const paper = getRegistry().get('openreview/paper');
        const rows = await paper.func({ id: 'abc123XYZ_' });
        expect(rows).toHaveLength(1);
        expect(rows[0].abstract).toBe('A long abstract with newlines.');
        expect(rows[0].pdf).toBe('https://openreview.net/pdf/abc.pdf');
    });

    it('reviews rejects max-length below 200', async () => {
        const reviews = getRegistry().get('openreview/reviews');
        await expect(reviews.func({ forum: 'abc123XYZ_', 'max-length': 100 })).rejects.toMatchObject({ code: 'ARGUMENT' });
    });

    it('reviews emits PAPER first then sorts by cdate, classifies invitations, and joins sections', async () => {
        const replyReview = {
            id: 'review1aaa',
            forum: 'abc123XYZ_',
            replyto: 'abc123XYZ_',
            cdate: 1727524900000,
            invitations: ['ICLR.cc/2025/Conference/Submission1/-/Official_Review'],
            signatures: ['ICLR.cc/2025/Conference/Submission1/Reviewer_uVwr'],
            content: {
                summary: { value: 'Short summary' },
                strengths: { value: 'Solid baselines' },
                weaknesses: { value: 'Limited novelty' },
                rating: { value: 5 },
                confidence: { value: 4 },
            },
        };
        const replyDecision = {
            id: 'decision01',
            forum: 'abc123XYZ_',
            replyto: 'abc123XYZ_',
            cdate: 1727525000000,
            invitations: ['ICLR.cc/2025/Conference/-/Decision'],
            signatures: ['ICLR.cc/2025/Conference/Program_Chairs'],
            content: {
                decision: { value: 'Accept (poster)' },
            },
        };
        const replyMetaReview = {
            id: 'meta000001',
            forum: 'abc123XYZ_',
            replyto: 'abc123XYZ_',
            cdate: 1727524950000,
            invitations: ['ICLR.cc/2025/Conference/Submission1/-/Meta_Review'],
            signatures: ['ICLR.cc/2025/Conference/Area_Chair_1'],
            content: {
                summary: { value: 'Meta summary' },
            },
        };
        vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url) => {
            const href = String(url);
            if (href.includes('/notes?id=')) {
                return new Response(JSON.stringify({ notes: [SAMPLE_NOTE] }), { status: 200 });
            }
            return new Response(JSON.stringify({ notes: [replyDecision, replyReview, { ...SAMPLE_NOTE }, replyMetaReview] }), { status: 200 });
        }));
        const reviews = getRegistry().get('openreview/reviews');
        const rows = await reviews.func({ forum: 'abc123XYZ_', 'max-length': 4000 });
        expect(rows[0].type).toBe('PAPER');
        expect(rows.filter((row) => row.type === 'PAPER')).toHaveLength(1);
        expect(rows[1].type).toBe('REVIEW');
        expect(rows[1].author).toBe('Reviewer_uVwr');
        expect(rows[1].rating).toBe('5');
        expect(rows[1].confidence).toBe('4');
        expect(rows[1].text).toContain('Summary: Short summary');
        expect(rows[1].text).toContain('Strengths: Solid baselines');
        expect(rows[2].type).toBe('META_REVIEW');
        expect(rows[2].author).toBe('Area_Chair_1');
        expect(rows[2].text).toContain('Summary: Meta summary');
        expect(rows[3].type).toBe('DECISION');
        expect(rows[3].author).toBe('Program_Chairs');
        expect(rows[3].text).toContain('Decision: Accept (poster)');
    });

    it('reviews still emits PAPER row 0 when forum replies response omits the root note', async () => {
        const replyReview = {
            id: 'review1aaa',
            forum: 'abc123XYZ_',
            replyto: 'abc123XYZ_',
            cdate: 1727524900000,
            invitations: ['ICLR.cc/2025/Conference/Submission1/-/Official_Review'],
            signatures: ['ICLR.cc/2025/Conference/Submission1/Reviewer_uVwr'],
            content: { summary: { value: 'Short summary' } },
        };
        vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url) => {
            const href = String(url);
            if (href.includes('/notes?id=')) {
                return new Response(JSON.stringify({ notes: [SAMPLE_NOTE] }), { status: 200 });
            }
            return new Response(JSON.stringify({ notes: [replyReview] }), { status: 200 });
        }));
        const reviews = getRegistry().get('openreview/reviews');
        const rows = await reviews.func({ forum: 'abc123XYZ_', 'max-length': 4000 });
        expect(rows[0].type).toBe('PAPER');
        expect(rows[0].author).toBe('');
        expect(rows[1].type).toBe('REVIEW');
    });

    it('reviews truncates long text to max-length with ellipsis', async () => {
        const longReview = {
            id: 'longreview1',
            forum: 'abc123XYZ_',
            replyto: 'abc123XYZ_',
            cdate: 1727524900000,
            invitations: ['ICLR.cc/2025/Conference/Submission1/-/Official_Review'],
            signatures: ['ICLR.cc/2025/Conference/Submission1/Reviewer_xxxx'],
            content: { summary: { value: 'x'.repeat(5000) } },
        };
        vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url) => {
            const href = String(url);
            if (href.includes('/notes?id=')) {
                return new Response(JSON.stringify({ notes: [SAMPLE_NOTE] }), { status: 200 });
            }
            return new Response(JSON.stringify({ notes: [longReview] }), { status: 200 });
        }));
        const reviews = getRegistry().get('openreview/reviews');
        const rows = await reviews.func({ forum: 'abc123XYZ_', 'max-length': 500 });
        expect(rows[1].text.length).toBe(500);
        expect(rows[1].text.endsWith('...')).toBe(true);
    });

    it('author rejects invalid profile ids before calling the network', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const author = getRegistry().get('openreview/author');
        await expect(author.func({ profile: 'Bo_Liu17', limit: 5 })).rejects.toMatchObject({ code: 'ARGUMENT' });
        await expect(author.func({ profile: '', limit: 5 })).rejects.toMatchObject({ code: 'ARGUMENT' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('author throws EmptyResult when the profile has no submissions', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ notes: [] }), { status: 200 })));
        const author = getRegistry().get('openreview/author');
        await expect(author.func({ profile: '~No_Submissions1', limit: 5 })).rejects.toMatchObject({ code: 'EMPTY_RESULT' });
    });

    it('author wraps non-200 responses as CommandExecutionError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 })));
        const author = getRegistry().get('openreview/author');
        await expect(author.func({ profile: '~Bo_Liu17', limit: 5 })).rejects.toMatchObject({ code: 'COMMAND_EXEC' });
    });

    it('author wraps fetch network errors as CommandExecutionError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
        const author = getRegistry().get('openreview/author');
        await expect(author.func({ profile: '~Bo_Liu17', limit: 5 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('Network failure'),
        });
    });

    it('author hits /notes?content.authorids and returns rank-ordered rows', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ notes: [SAMPLE_NOTE, SAMPLE_NOTE] }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const author = getRegistry().get('openreview/author');
        const rows = await author.func({ profile: '~Bo_Liu17', limit: 50 });
        expect(rows).toHaveLength(2);
        expect(rows[0]).toEqual({
            rank: 1,
            id: 'abc123XYZ_',
            title: 'Test Paper Title with spaces',
            authors: 'Alice Smith, Bob Jones',
            venue: 'ICLR 2024 oral',
            pdate: '2024-09-28',
            url: 'https://openreview.net/forum?id=abc123XYZ_',
        });
        expect(rows[1].rank).toBe(2);
        // Confirm the request shape: canonical authorids filter + cdate sort.
        const url = fetchMock.mock.calls[0][0];
        expect(url).toContain('content.authorids=');
        expect(url).toContain(encodeURIComponent('~Bo_Liu17'));
        expect(url).toContain('sort=cdate:desc');
    });
});
