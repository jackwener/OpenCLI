import { describe, expect, it } from 'vitest';

import { INDEED_ORIGIN, coerceInt, requireBoundedInt, requireNonNegativeInt, requireJobKey, requireQuery, requireFromage, requireSort, buildSearchUrl, buildJobUrl, dedupeTags, searchCardToRow } from './utils.js';

describe('indeed adapter — coerceInt', () => {
    it('accepts integers and integer strings', () => {
        expect(coerceInt(5)).toBe(5);
        expect(coerceInt('5')).toBe(5);
        expect(coerceInt(0)).toBe(0);
    });
    it('rejects floats / non-numeric / empty / NaN', () => {
        expect(coerceInt(1.5)).toBeNaN();
        expect(coerceInt('1.5')).toBeNaN();
        expect(coerceInt('abc')).toBeNaN();
        expect(coerceInt('')).toBeNaN();
        expect(coerceInt(null)).toBeNaN();
        expect(coerceInt(undefined)).toBeNaN();
    });
});

describe('indeed adapter — argument validators', () => {
    it('requireBoundedInt enforces bounds', () => {
        expect(requireBoundedInt(15, 15, 25, 'limit')).toBe(15);
        expect(requireBoundedInt('20', 15, 25, 'limit')).toBe(20);
        expect(() => requireBoundedInt(0, 15, 25, 'limit')).toThrow(/positive integer/);
        expect(() => requireBoundedInt(-5, 15, 25, 'limit')).toThrow(/positive integer/);
        expect(() => requireBoundedInt(30, 15, 25, 'limit')).toThrow(/<= 25/);
        expect(() => requireBoundedInt('abc', 15, 25, 'limit')).toThrow(/positive integer/);
        expect(() => requireBoundedInt(1.5, 15, 25, 'limit')).toThrow(/positive integer/);
    });

    it('requireNonNegativeInt allows zero', () => {
        expect(requireNonNegativeInt(0, 0, 'start')).toBe(0);
        expect(requireNonNegativeInt('20', 0, 'start')).toBe(20);
        expect(() => requireNonNegativeInt(-1, 0, 'start')).toThrow(/non-negative/);
        expect(() => requireNonNegativeInt('1.5', 0, 'start')).toThrow(/non-negative/);
    });

    it('requireJobKey validates the 16-char hex shape', () => {
        expect(requireJobKey('dccc07ac5a6a3683')).toBe('dccc07ac5a6a3683');
        expect(requireJobKey('DCCC07AC5A6A3683')).toBe('dccc07ac5a6a3683');
        expect(requireJobKey('  abc123def4567890  ')).toBe('abc123def4567890');
        expect(() => requireJobKey('')).toThrow(/required/);
        expect(() => requireJobKey('   ')).toThrow(/required/);
        expect(() => requireJobKey('not-hex')).toThrow(/valid jk/);
        expect(() => requireJobKey('abc123')).toThrow(/valid jk/); // too short
        expect(() => requireJobKey('xyz123def456789012')).toThrow(/valid jk/); // non-hex chars
    });

    it('requireQuery rejects empty / whitespace', () => {
        expect(requireQuery('software engineer')).toBe('software engineer');
        expect(requireQuery('  rust  ')).toBe('rust');
        expect(() => requireQuery('')).toThrow(/cannot be empty/);
        expect(() => requireQuery('   ')).toThrow(/cannot be empty/);
        expect(() => requireQuery(null)).toThrow(/cannot be empty/);
    });

    it('requireFromage allows empty + whitelist values only', () => {
        expect(requireFromage('')).toBe('');
        expect(requireFromage(undefined)).toBe('');
        expect(requireFromage('1')).toBe('1');
        expect(requireFromage('14')).toBe('14');
        expect(() => requireFromage('30')).toThrow(/1\/3\/7\/14/);
        expect(() => requireFromage('abc')).toThrow(/1\/3\/7\/14/);
    });

    it('requireSort accepts only relevance/date', () => {
        expect(requireSort('relevance')).toBe('relevance');
        expect(requireSort('date')).toBe('date');
        expect(requireSort('DATE')).toBe('date');
        expect(requireSort(undefined)).toBe('relevance');
        expect(() => requireSort('newest')).toThrow(/relevance.*date/);
    });
});

describe('indeed adapter — URL builders', () => {
    it('buildSearchUrl encodes query and omits empty params', () => {
        const url = buildSearchUrl({ query: 'software engineer', location: '', fromage: '', sort: 'relevance', start: 0 });
        expect(url).toBe(`${INDEED_ORIGIN}/jobs?q=software+engineer`);
    });

    it('buildSearchUrl includes location, fromage, sort=date, start when set', () => {
        const url = buildSearchUrl({ query: 'rust', location: 'remote', fromage: '7', sort: 'date', start: 20 });
        expect(url).toBe(`${INDEED_ORIGIN}/jobs?q=rust&l=remote&fromage=7&sort=date&start=20`);
    });

    it('buildSearchUrl omits sort when relevance (the default) and start when 0', () => {
        const url = buildSearchUrl({ query: 'go', location: 'NY', fromage: '', sort: 'relevance', start: 0 });
        expect(url).toBe(`${INDEED_ORIGIN}/jobs?q=go&l=NY`);
    });

    it('buildJobUrl points at /viewjob with the jk', () => {
        expect(buildJobUrl('dccc07ac5a6a3683')).toBe(`${INDEED_ORIGIN}/viewjob?jk=dccc07ac5a6a3683`);
    });
});

describe('indeed adapter — DOM normalizers', () => {
    it('dedupeTags drops the salary duplicate and trims', () => {
        const tags = ['$50 - $100 an hour', 'Contract', 'Hourly pay', 'Flexible schedule', 'Contract'];
        expect(dedupeTags(tags, '$50 - $100 an hour')).toBe('Contract · Hourly pay · Flexible schedule');
    });

    it('dedupeTags handles empty / no-salary input', () => {
        expect(dedupeTags([], '')).toBe('');
        expect(dedupeTags(['', '  ', null, 'Full-time'], '')).toBe('Full-time');
    });

    it('searchCardToRow normalizes a fully populated card', () => {
        const card = {
            jk: 'a0021a1886f32d09',
            title: '  Senior  Software   Engineer ',
            company: 'Somos, Inc.',
            location: 'Remote',
            salary: '$150,000 - $179,000 a year',
            tags: [
                '$150,000 - $179,000 a year',
                'Full-time',
                '401(k)',
            ],
        };
        const row = searchCardToRow(card, 1);
        expect(row).toEqual({
            rank: 1,
            id: 'a0021a1886f32d09',
            title: 'Senior Software Engineer',
            company: 'Somos, Inc.',
            location: 'Remote',
            salary: '$150,000 - $179,000 a year',
            tags: 'Full-time · 401(k)',
            url: `${INDEED_ORIGIN}/viewjob?jk=a0021a1886f32d09`,
        });
    });

    it('searchCardToRow drops url when jk is missing rather than emit a broken URL', () => {
        const row = searchCardToRow({ title: 'X' }, 5);
        expect(row.id).toBe('');
        expect(row.url).toBe('');
        expect(row.rank).toBe(5);
    });
});
