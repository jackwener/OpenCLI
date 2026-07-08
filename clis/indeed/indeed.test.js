import { describe, expect, it, vi } from 'vitest';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import {
    INDEED_ORIGIN,
    SEARCH_COLUMNS,
    JOB_COLUMNS,
    coerceInt,
    requireBoundedInt,
    requireNonNegativeInt,
    requireJobKey,
    requireQuery,
    requireFromage,
    requireSort,
    buildSearchUrl,
    buildJobUrl,
    dedupeTags,
    searchCardToRow,
} from './utils.js';
import './search.js';
import './job.js';

function createPageMock(evaluateResult) {
    const evaluate = typeof evaluateResult === 'function'
        ? vi.fn(evaluateResult)
        : vi.fn().mockResolvedValue(evaluateResult);
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate,
    };
}

describe('indeed adapter — registration', () => {
    it('registers search and job commands with the expected shape', () => {
        const search = getRegistry().get('indeed/search');
        const job = getRegistry().get('indeed/job');

        expect(search).toBeDefined();
        expect(search.browser).toBe(true);
        expect(search.strategy).toBe('cookie');
        expect(search.navigateBefore).toBe(false);
        expect(search.columns).toEqual(SEARCH_COLUMNS);

        expect(job).toBeDefined();
        expect(job.browser).toBe(true);
        expect(job.strategy).toBe('cookie');
        expect(job.navigateBefore).toBe(false);
        expect(job.columns).toEqual(JOB_COLUMNS);
        expect(job.aliases).toContain('detail');
        expect(job.aliases).toContain('view');
    });

    it('declares no overlap between search and job columns shape', () => {
        expect(SEARCH_COLUMNS).toContain('rank');
        expect(SEARCH_COLUMNS).toContain('id');
        expect(SEARCH_COLUMNS).toContain('url');
        expect(JOB_COLUMNS).toContain('description');
        expect(JOB_COLUMNS).not.toContain('rank');
    });
});

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

describe('indeed adapter — search runtime', () => {
    it('fails fast on invalid limit before opening the page', async () => {
        const page = createPageMock({ cards: [], challenge: false, ready: true });
        const search = getRegistry().get('indeed/search');

        await expect(search.func(page, { query: 'rust engineer', limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });

    it('maps a Cloudflare challenge page to CommandExecutionError', async () => {
        const page = createPageMock({ cards: [], challenge: true, ready: true });
        const search = getRegistry().get('indeed/search');

        await expect(search.func(page, { query: 'rust engineer' })).rejects.toBeInstanceOf(CommandExecutionError);
        expect(page.goto).toHaveBeenCalledWith(`${INDEED_ORIGIN}/jobs?q=rust+engineer`);
        expect(page.wait).toHaveBeenCalledWith(4);
        expect(page.evaluate).toHaveBeenCalledTimes(1);
    });

    it('treats poll timeout / selector drift as CommandExecutionError, not EmptyResultError', async () => {
        const page = createPageMock({ cards: [], challenge: false, ready: false });
        const search = getRegistry().get('indeed/search');

        await expect(search.func(page, { query: 'rust engineer' })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('does not misclassify data-jk-only drift as EmptyResultError', async () => {
        const page = createPageMock({ cards: [], challenge: false, ready: false });
        const search = getRegistry().get('indeed/search');

        await expect(search.func(page, { query: 'rust engineer' })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('maps an empty but ready page to EmptyResultError', async () => {
        const page = createPageMock({ cards: [], challenge: false, ready: true });
        const search = getRegistry().get('indeed/search');

        await expect(search.func(page, { query: 'zzzxxyyqqnonexistent', location: 'Remote' })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('returns normalized rows for a happy-path search result', async () => {
        const page = createPageMock({
            cards: [{
                jk: 'dccc07ac5a6a3683',
                title: ' Senior  Rust Engineer ',
                company: 'Acme',
                location: 'Remote',
                salary: '$180,000 a year',
                tags: ['$180,000 a year', 'Full-time', '401(k)'],
            }],
            challenge: false,
            ready: true,
        });
        const search = getRegistry().get('indeed/search');

        const rows = await search.func(page, {
            query: 'rust engineer',
            location: 'Remote',
            fromage: '7',
            sort: 'date',
            start: 10,
            limit: 1,
        });

        expect(page.goto).toHaveBeenCalledWith(`${INDEED_ORIGIN}/jobs?q=rust+engineer&l=Remote&fromage=7&sort=date&start=10`);
        expect(rows).toEqual([{
            rank: 11,
            id: 'dccc07ac5a6a3683',
            title: 'Senior Rust Engineer',
            company: 'Acme',
            location: 'Remote',
            salary: '$180,000 a year',
            tags: 'Full-time · 401(k)',
            url: `${INDEED_ORIGIN}/viewjob?jk=dccc07ac5a6a3683`,
        }]);
    });
});

describe('indeed adapter — job runtime', () => {
    it('fails fast on invalid jk before browser/network work', async () => {
        const page = createPageMock({
            ready: true,
            challenge: false,
            notFound: false,
            title: 'Demo',
            description: 'Demo',
        });
        const job = getRegistry().get('indeed/job');

        await expect(job.func(page, { id: 'not-hex' })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });

    it('maps a Cloudflare challenge page to CommandExecutionError', async () => {
        const page = createPageMock({
            ready: true,
            challenge: true,
            notFound: false,
            title: '',
            company: '',
            location: '',
            salary: '',
            jobType: '',
            description: '',
        });
        const job = getRegistry().get('indeed/job');

        await expect(job.func(page, { id: 'dccc07ac5a6a3683' })).rejects.toBeInstanceOf(CommandExecutionError);
        expect(page.goto).toHaveBeenCalledWith(`${INDEED_ORIGIN}/viewjob?jk=dccc07ac5a6a3683`);
        expect(page.wait).toHaveBeenCalledWith(4);
    });

    it('treats missing ready markers as CommandExecutionError, not EmptyResultError', async () => {
        const page = createPageMock({
            ready: false,
            challenge: false,
            notFound: false,
            title: '',
            company: '',
            location: '',
            salary: '',
            jobType: '',
            description: '',
        });
        const job = getRegistry().get('indeed/job');

        await expect(job.func(page, { id: 'dccc07ac5a6a3683' })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('maps a not-found page to EmptyResultError', async () => {
        const page = createPageMock({
            ready: true,
            challenge: false,
            notFound: true,
            title: '',
            company: '',
            location: '',
            salary: '',
            jobType: '',
            description: '',
        });
        const job = getRegistry().get('indeed/job');

        await expect(job.func(page, { id: 'dccc07ac5a6a3683' })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('returns the normalized job detail row on success', async () => {
        const page = createPageMock({
            ready: true,
            challenge: false,
            notFound: false,
            title: ' Senior Rust Engineer ',
            company: 'Acme',
            location: 'Remote',
            salary: '$180,000 a year',
            jobType: 'Full-time',
            description: 'Build systems',
        });
        const job = getRegistry().get('indeed/job');

        const rows = await job.func(page, { id: 'DCCC07AC5A6A3683' });

        expect(rows).toEqual([{
            id: 'dccc07ac5a6a3683',
            title: 'Senior Rust Engineer',
            company: 'Acme',
            location: 'Remote',
            salary: '$180,000 a year',
            job_type: 'Full-time',
            description: 'Build systems',
            url: `${INDEED_ORIGIN}/viewjob?jk=dccc07ac5a6a3683`,
        }]);
    });
});
