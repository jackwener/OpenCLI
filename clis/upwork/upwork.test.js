import { describe, expect, it, vi } from 'vitest';
import {
    ArgumentError,
    AuthRequiredError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import {
    UPWORK_ORIGIN,
    LIST_COLUMNS,
    DETAIL_COLUMNS,
    requireQuery,
    requirePositiveInt,
    requireBoundedInt,
    requireCiphertext,
    requireFeedTab,
    requireSort,
    buildSearchUrl,
    buildFeedUrl,
    feedStateKey,
    buildJobUrl,
    stripHighlight,
    decodeExperienceLevel,
    decodeWorkload,
    decodeProposalsTier,
    formatBudget,
    formatBudgetFromDetail,
    jobType,
    formatSkills,
    jobToListRow,
} from './utils.js';
import './search.js';
import './feed.js';
import './detail.js';

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

describe('upwork adapter — registration', () => {
    it('registers search/feed/detail with the expected shape', () => {
        const search = getRegistry().get('upwork/search');
        const feed = getRegistry().get('upwork/feed');
        const detail = getRegistry().get('upwork/detail');

        expect(search).toBeDefined();
        expect(search.browser).toBe(true);
        expect(search.strategy).toBe('cookie');
        expect(search.navigateBefore).toBe(false);
        expect(search.columns).toEqual(LIST_COLUMNS);

        expect(feed).toBeDefined();
        expect(feed.browser).toBe(true);
        expect(feed.strategy).toBe('cookie');
        expect(feed.columns).toEqual(LIST_COLUMNS);
        expect(feed.aliases).toContain('best-matches');

        expect(detail).toBeDefined();
        expect(detail.browser).toBe(true);
        expect(detail.strategy).toBe('cookie');
        expect(detail.columns).toEqual(DETAIL_COLUMNS);
        expect(detail.aliases).toContain('job');
        expect(detail.aliases).toContain('view');
    });

    it('shares list columns between search and feed but not detail', () => {
        expect(LIST_COLUMNS).toContain('rank');
        expect(LIST_COLUMNS).toContain('proposalsTier');
        expect(DETAIL_COLUMNS).toContain('description');
        expect(DETAIL_COLUMNS).not.toContain('rank');
    });
});

describe('upwork adapter — argument validators', () => {
    it('requireQuery trims and rejects empty', () => {
        expect(requireQuery('  python  ')).toBe('python');
        expect(() => requireQuery('')).toThrow(ArgumentError);
        expect(() => requireQuery('   ')).toThrow(ArgumentError);
        expect(() => requireQuery(null)).toThrow(ArgumentError);
    });

    it('requirePositiveInt rejects zero / negative / floats', () => {
        expect(requirePositiveInt(1, 1, 'page')).toBe(1);
        expect(requirePositiveInt('5', 1, 'page')).toBe(5);
        expect(() => requirePositiveInt(0, 1, 'page')).toThrow(/positive integer/);
        expect(() => requirePositiveInt(-1, 1, 'page')).toThrow(/positive integer/);
        expect(() => requirePositiveInt(1.5, 1, 'page')).toThrow(/positive integer/);
        expect(() => requirePositiveInt('abc', 1, 'page')).toThrow(/positive integer/);
    });

    it('requireBoundedInt enforces both bounds (no silent clamp)', () => {
        expect(requireBoundedInt(20, 20, 1, 50, 'limit')).toBe(20);
        expect(requireBoundedInt('50', 20, 1, 50, 'limit')).toBe(50);
        expect(() => requireBoundedInt(0, 20, 1, 50, 'limit')).toThrow(/positive integer/);
        expect(() => requireBoundedInt(100, 20, 1, 50, 'limit')).toThrow(/<= 50/);
        expect(() => requireBoundedInt(0, 20, 10, 50, 'per_page')).toThrow(/positive integer/);
        expect(() => requireBoundedInt(5, 20, 10, 50, 'per_page')).toThrow(/>= 10/);
    });

    it('requireCiphertext accepts ~01/~02 forms and rejects garbage', () => {
        expect(requireCiphertext('~022054964136512093518')).toBe('~022054964136512093518');
        expect(requireCiphertext('~012055605504980235850')).toBe('~012055605504980235850');
        expect(requireCiphertext('https://www.upwork.com/jobs/~022054964136512093518')).toBe('~022054964136512093518');
        expect(requireCiphertext('  ~022054964136512093518  ')).toBe('~022054964136512093518');
        expect(() => requireCiphertext('')).toThrow(ArgumentError);
        expect(() => requireCiphertext('~03abc')).toThrow(/valid ciphertext/);
        expect(() => requireCiphertext('not-a-job-id')).toThrow(ArgumentError);
    });

    it('requireFeedTab validates the small enum', () => {
        expect(requireFeedTab('best-matches')).toBe('best-matches');
        expect(requireFeedTab('MOST-RECENT')).toBe('most-recent');
        expect(requireFeedTab(undefined)).toBe('best-matches');
        expect(() => requireFeedTab('saved')).toThrow(/best-matches/);
    });

    it('requireSort validates the small enum', () => {
        expect(requireSort('recency')).toBe('recency');
        expect(requireSort('RELEVANCE')).toBe('relevance');
        expect(requireSort(undefined)).toBe('recency');
        expect(() => requireSort('best')).toThrow(/recency/);
    });
});

describe('upwork adapter — URL builders', () => {
    it('buildSearchUrl emits a canonical, round-trippable URL', () => {
        expect(buildSearchUrl({ query: 'python', sort: 'recency', page: 1, perPage: 10 }))
            .toBe(`${UPWORK_ORIGIN}/nx/search/jobs/?q=python`);
        expect(buildSearchUrl({ query: 'python developer', location: 'United States', sort: 'relevance', page: 2, perPage: 25 }))
            .toBe(`${UPWORK_ORIGIN}/nx/search/jobs/?q=python+developer&location=United+States&sort=relevance&per_page=25&page=2`);
        expect(buildSearchUrl({ query: 'react', category: 'web-development', sort: 'recency', page: 1, perPage: 10 }))
            .toBe(`${UPWORK_ORIGIN}/nx/search/jobs/?q=react&category2_uid=web-development`);
    });

    it('buildFeedUrl returns the right path per tab', () => {
        expect(buildFeedUrl('best-matches')).toBe(`${UPWORK_ORIGIN}/nx/find-work/best-matches`);
        expect(buildFeedUrl('most-recent')).toBe(`${UPWORK_ORIGIN}/nx/find-work/most-recent`);
    });

    it('feedStateKey maps tab → Nuxt state slot', () => {
        expect(feedStateKey('best-matches')).toBe('feedBestMatch');
        expect(feedStateKey('most-recent')).toBe('feedMostRecent');
    });

    it('buildJobUrl prepends the origin', () => {
        expect(buildJobUrl('~022054964136512093518')).toBe(`${UPWORK_ORIGIN}/jobs/~022054964136512093518`);
    });
});

describe('upwork adapter — text + field normalizers', () => {
    it('stripHighlight removes Upwork query-highlight markup and collapses whitespace', () => {
        expect(stripHighlight('Software <span class="highlight">Developer</span> (Client-Facing)'))
            .toBe('Software Developer (Client-Facing)');
        expect(stripHighlight('  multi\n\nline   ')).toBe('multi line');
        expect(stripHighlight(null)).toBe('');
        expect(stripHighlight(undefined)).toBe('');
    });

    it('decodeExperienceLevel handles i18n keys, rendered labels, and numeric tiers', () => {
        expect(decodeExperienceLevel('jsn_Entry_205')).toBe('entry');
        expect(decodeExperienceLevel('jsn_Intermediate_206')).toBe('intermediate');
        expect(decodeExperienceLevel('jsn_Expert_207')).toBe('expert');
        expect(decodeExperienceLevel('Entry level')).toBe('entry');
        expect(decodeExperienceLevel('Intermediate')).toBe('intermediate');
        expect(decodeExperienceLevel('Expert')).toBe('expert');
        expect(decodeExperienceLevel(1)).toBe('entry');
        expect(decodeExperienceLevel(2)).toBe('intermediate');
        expect(decodeExperienceLevel(3)).toBe('expert');
        expect(decodeExperienceLevel(null)).toBe('');
        expect(decodeExperienceLevel('')).toBe('');
        expect(decodeExperienceLevel('Mystery_999')).toBe('');
    });

    it('decodeWorkload extracts engagement suffix and normalizes', () => {
        expect(decodeWorkload('usnuxt_Engagement_421.fullTime')).toBe('full-time');
        expect(decodeWorkload('usnuxt_Engagement_421.partTime')).toBe('part-time');
        expect(decodeWorkload('More than 30 hrs/week')).toBe('More than 30 hrs/week');
        expect(decodeWorkload(null)).toBe('');
        expect(decodeWorkload('')).toBe('');
    });

    it('decodeProposalsTier maps both i18n-keyed and rendered buckets', () => {
        expect(decodeProposalsTier('usnuxt_JobProposalTier_418.lessThan5')).toBe('<5');
        expect(decodeProposalsTier('usnuxt_JobProposalTier_418.5to10')).toBe('5-10');
        expect(decodeProposalsTier('usnuxt_JobProposalTier_418.10to15')).toBe('10-15');
        expect(decodeProposalsTier('usnuxt_JobProposalTier_418.20to50')).toBe('20-50');
        expect(decodeProposalsTier('usnuxt_JobProposalTier_418.50Plus')).toBe('50+');
        expect(decodeProposalsTier('15 to 20')).toBe('15-20');
        expect(decodeProposalsTier('5 to 10')).toBe('5-10');
        expect(decodeProposalsTier(null)).toBe('');
    });

    it('formatBudget handles hourly ranges, single bounds, fixed, and missing', () => {
        expect(formatBudget({ type: 2, hourlyBudget: { min: 40, max: 70 } })).toBe('$40-$70/hr');
        expect(formatBudget({ type: 2, hourlyBudget: { min: 30, max: 30 } })).toBe('$30/hr');
        expect(formatBudget({ type: 2, hourlyBudget: { min: 0, max: 50 } })).toBe('$50/hr');
        expect(formatBudget({ type: 2, hourlyBudget: { min: 25, max: 0 } })).toBe('$25/hr');
        expect(formatBudget({ type: 2, hourlyBudget: { min: 0, max: 0 } })).toBe('');
        expect(formatBudget({ type: 1, amount: { amount: 200 } })).toBe('$200');
        expect(formatBudget({ type: 1, amount: { amount: 0 } })).toBe('');
        expect(formatBudget({ type: null })).toBe('');
        expect(formatBudget(null)).toBe('');
    });

    it('formatBudgetFromDetail reads extendedBudgetInfo and budget.amount', () => {
        expect(formatBudgetFromDetail({ type: 2, extendedBudgetInfo: { hourlyBudgetMin: 40, hourlyBudgetMax: 70 } })).toBe('$40-$70/hr');
        expect(formatBudgetFromDetail({ type: 1, budget: { amount: 500 } })).toBe('$500');
        expect(formatBudgetFromDetail({ type: 2, extendedBudgetInfo: { hourlyBudgetMin: 0, hourlyBudgetMax: 0 } })).toBe('');
        expect(formatBudgetFromDetail({ type: 1, budget: { amount: 0 } })).toBe('');
    });

    it('jobType returns stable labels', () => {
        expect(jobType(1)).toBe('fixed');
        expect(jobType(2)).toBe('hourly');
        expect(jobType(0)).toBe('');
        expect(jobType(null)).toBe('');
    });

    it('formatSkills dedupes across attrs / skills / ontologySkills', () => {
        expect(formatSkills({ attrs: [{ prettyName: 'Python' }, { prettyName: 'JavaScript' }, { prettyName: 'Python' }] }))
            .toBe('Python, JavaScript');
        expect(formatSkills({ skills: [{ prefLabel: 'Android' }, { prefLabel: 'QA Testing' }] }))
            .toBe('Android, QA Testing');
        expect(formatSkills({ ontologySkills: [{ name: 'React' }] })).toBe('React');
        expect(formatSkills({})).toBe('');
        expect(formatSkills(null)).toBe('');
    });
});

describe('upwork adapter — jobToListRow', () => {
    it('produces a row matching LIST_COLUMNS keys and order', () => {
        const job = {
            ciphertext: '~022054964136512093518',
            title: 'Software <span class="highlight">Developer</span>',
            type: 2,
            hourlyBudget: { min: 40, max: 70 },
            tierText: 'jsn_Intermediate_206',
            proposalsTier: 'usnuxt_JobProposalTier_418.50Plus',
            attrs: [{ prettyName: 'Python' }, { prettyName: 'SQL' }],
            client: { location: { country: 'United States' }, totalFeedback: 4.87 },
            publishedOn: '2026-05-14T16:37:43.507Z',
        };
        const row = jobToListRow(job, 3);
        expect(Object.keys(row)).toEqual(LIST_COLUMNS);
        expect(row).toEqual({
            rank: 3,
            id: '~022054964136512093518',
            title: 'Software Developer',
            type: 'hourly',
            budget: '$40-$70/hr',
            experienceLevel: 'intermediate',
            proposalsTier: '50+',
            skills: 'Python, SQL',
            clientCountry: 'United States',
            clientRating: 4.87,
            publishedOn: '2026-05-14T16:37:43.507Z',
            url: 'https://www.upwork.com/jobs/~022054964136512093518',
        });
    });

    it('drops zero / NaN client rating to null, never silently labels 0 as a real score', () => {
        const job = { ciphertext: '~022054964136512093518', client: { totalFeedback: 0 } };
        expect(jobToListRow(job, 1).clientRating).toBeNull();
        const job2 = { ciphertext: '~022054964136512093518', client: { totalFeedback: null } };
        expect(jobToListRow(job2, 1).clientRating).toBeNull();
    });

    it('falls back to createdOn when publishedOn is missing', () => {
        const job = {
            ciphertext: '~022054964136512093518',
            type: 2,
            hourlyBudget: { min: 0, max: 0 },
            createdOn: '2026-01-01T00:00:00.000Z',
        };
        expect(jobToListRow(job, 1).publishedOn).toBe('2026-01-01T00:00:00.000Z');
    });

    it('returns null instead of non-round-trippable rows when ciphertext is missing or malformed', () => {
        expect(jobToListRow({ ciphertext: '', title: 'missing id' }, 1)).toBeNull();
        expect(jobToListRow({ ciphertext: '12345', title: 'bad id' }, 1)).toBeNull();
        expect(jobToListRow({ title: 'no id' }, 1)).toBeNull();
    });
});

describe('upwork search — func behavior', () => {
    const cmd = () => getRegistry().get('upwork/search');

    it('returns rows on a populated state', async () => {
        const page = createPageMock({
            ready: true,
            onLogin: false,
            challenge: false,
            jobsPresent: true,
            jobs: [
                { ciphertext: '~022054964136512093518', title: 'A', type: 2, hourlyBudget: { min: 10, max: 20 }, attrs: [], client: {} },
                { ciphertext: '~022055605504980235850', title: 'B', type: 1, amount: { amount: 100 }, attrs: [], client: {} },
            ],
            paging: { total: 2, offset: 0, count: 2 },
        });
        const rows = await cmd().func(page, { query: 'python', page: 1, per_page: 10 });
        expect(rows).toHaveLength(2);
        expect(rows[0].rank).toBe(1);
        expect(rows[0].type).toBe('hourly');
        expect(rows[1].rank).toBe(2);
        expect(rows[1].type).toBe('fixed');
        expect(page.goto).toHaveBeenCalledWith(expect.stringContaining('/nx/search/jobs/?q=python'));
    });

    it('uses pageNum/perPage to compute the starting rank', async () => {
        const page = createPageMock({
            ready: true, onLogin: false, challenge: false,
            jobsPresent: true,
            jobs: [{ ciphertext: '~022054964136512093518', title: 'A', type: 2, attrs: [], client: {} }],
        });
        const rows = await cmd().func(page, { query: 'python', page: 3, per_page: 10 });
        expect(rows[0].rank).toBe(21);
    });

    it('throws AuthRequiredError when redirected to login', async () => {
        const page = createPageMock({ ready: false, onLogin: true, challenge: false, jobs: [] });
        await expect(cmd().func(page, { query: 'python' })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('throws CommandExecutionError on Cloudflare challenge', async () => {
        const page = createPageMock({ ready: false, onLogin: false, challenge: true, jobs: [] });
        await expect(cmd().func(page, { query: 'python' })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('throws CommandExecutionError when state never hydrates', async () => {
        const page = createPageMock({ ready: false, onLogin: false, challenge: false, jobs: [] });
        await expect(cmd().func(page, { query: 'python' })).rejects.toThrow(/was not present/);
    });

    it('throws EmptyResultError when the search returns zero jobs', async () => {
        const page = createPageMock({ ready: true, onLogin: false, challenge: false, jobsPresent: true, jobs: [], paging: { total: 0 } });
        await expect(cmd().func(page, { query: 'asdfqwerzxcv' })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('unwraps Browser Bridge envelopes at the evaluate boundary', async () => {
        const page = createPageMock({
            session: 'site:upwork',
            data: {
                ready: true,
                onLogin: false,
                challenge: false,
                jobsPresent: true,
                jobs: [{ ciphertext: '~022054964136512093518', title: 'A', type: 2, attrs: [], client: {} }],
            },
        });
        const rows = await cmd().func(page, { query: 'python' });
        expect(rows).toHaveLength(1);
        expect(rows[0].id).toBe('~022054964136512093518');
    });

    it('treats missing or malformed jobs state as parser drift, not legal empty', async () => {
        await expect(cmd().func(createPageMock({ ready: true, onLogin: false, challenge: false }), { query: 'python' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
        await expect(cmd().func(createPageMock({ ready: true, onLogin: false, challenge: false, jobsPresent: true, jobs: {} }), { query: 'python' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('fails closed when any search result lacks a round-trippable job id', async () => {
        const page = createPageMock({
            ready: true,
            onLogin: false,
            challenge: false,
            jobsPresent: true,
            jobs: [{ ciphertext: '~022054964136512093518', title: 'A' }, { ciphertext: '12345', title: 'B' }],
        });
        await expect(cmd().func(page, { query: 'python' })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('rejects empty query before opening the page', async () => {
        const page = createPageMock({ ready: true, jobs: [] });
        await expect(cmd().func(page, { query: '' })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });
});

describe('upwork feed — func behavior', () => {
    const cmd = () => getRegistry().get('upwork/feed');

    it('hits the best-matches URL by default', async () => {
        const page = createPageMock({
            ready: true, onLogin: false, challenge: false,
            jobsPresent: true,
            jobs: [{ ciphertext: '~022054964136512093518', title: 'A', type: 2, attrs: [], client: {} }],
        });
        const rows = await cmd().func(page, { tab: 'best-matches', limit: 5 });
        expect(rows).toHaveLength(1);
        expect(page.goto).toHaveBeenCalledWith('https://www.upwork.com/nx/find-work/best-matches');
    });

    it('switches URL for the most-recent tab', async () => {
        const page = createPageMock({
            ready: true, onLogin: false, challenge: false,
            jobsPresent: true,
            jobs: [{ ciphertext: '~022054964136512093518', title: 'A', type: 1, amount: { amount: 50 }, attrs: [], client: {} }],
        });
        await cmd().func(page, { tab: 'most-recent', limit: 5 });
        expect(page.goto).toHaveBeenCalledWith('https://www.upwork.com/nx/find-work/most-recent');
    });

    it('throws AuthRequiredError when redirected to login', async () => {
        const page = createPageMock({ ready: false, onLogin: true, challenge: false, jobs: [] });
        await expect(cmd().func(page, { tab: 'best-matches' })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('throws EmptyResultError for an empty feed without sentinel rows', async () => {
        const page = createPageMock({ ready: true, onLogin: false, challenge: false, jobsPresent: true, jobs: [] });
        await expect(cmd().func(page, { tab: 'best-matches' })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('unwraps Browser Bridge envelopes and rejects malformed feed jobs state', async () => {
        const rows = await cmd().func(createPageMock({
            session: 'site:upwork',
            data: {
                ready: true,
                onLogin: false,
                challenge: false,
                jobsPresent: true,
                jobs: [{ ciphertext: '~022054964136512093518', title: 'A', type: 2, attrs: [], client: {} }],
            },
        }), { tab: 'best-matches' });
        expect(rows[0].id).toBe('~022054964136512093518');

        await expect(cmd().func(createPageMock({ ready: true, onLogin: false, challenge: false, jobsPresent: true, jobs: null }), { tab: 'best-matches' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('fails closed when any feed result lacks a round-trippable job id', async () => {
        const page = createPageMock({
            ready: true,
            onLogin: false,
            challenge: false,
            jobsPresent: true,
            jobs: [{ ciphertext: '~022054964136512093518', title: 'A' }, { ciphertext: '', title: 'B' }],
        });
        await expect(cmd().func(page, { tab: 'best-matches' })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});

describe('upwork detail — func behavior', () => {
    const cmd = () => getRegistry().get('upwork/detail');

    it('returns one row from a populated jobDetails store', async () => {
        const page = createPageMock({
            ready: true, onLogin: false, challenge: false,
            job: {
                uid: '2054964136512093518',
                ciphertext: '~022054964136512093518',
                title: 'Software Developer',
                type: 2,
                extendedBudgetInfo: { hourlyBudgetMin: 40, hourlyBudgetMax: 70 },
                contractorTier: 2,
                workload: 'More than 30 hrs/week',
                category: { name: 'Web Development', urlSlug: 'web-development' },
                attrs: [{ prettyName: 'Python' }],
                description: 'We are looking for...',
                publishTime: '2026-05-14T16:37:43.507Z',
                clientActivity: { totalApplicants: 50, totalHired: 0 },
            },
            buyer: {
                stats: { score: 4.8, totalJobsWithHires: 5, totalCharges: { amount: 188.28 } },
                location: { country: 'United States' },
            },
        });
        const rows = await cmd().func(page, { id: '~022054964136512093518' });
        expect(rows).toHaveLength(1);
        const row = rows[0];
        expect(Object.keys(row)).toEqual(DETAIL_COLUMNS);
        expect(row.id).toBe('~022054964136512093518');
        expect(row.type).toBe('hourly');
        expect(row.budget).toBe('$40-$70/hr');
        expect(row.experienceLevel).toBe('intermediate');
        expect(row.workload).toBe('More than 30 hrs/week');
        expect(row.category).toBe('Web Development');
        expect(row.skills).toBe('Python');
        expect(row.clientCountry).toBe('United States');
        expect(row.clientSpent).toBe(188.28);
        expect(row.clientHires).toBe(5);
        expect(row.clientRating).toBe(4.8);
        expect(row.proposalsCount).toBe(50);
        expect(row.url).toBe('https://www.upwork.com/jobs/~022054964136512093518');
    });

    it('accepts a full /jobs/ URL as the positional id', async () => {
        const page = createPageMock({
            ready: true, onLogin: false, challenge: false,
            job: { ciphertext: '~022054964136512093518', title: 'X', type: 1, budget: { amount: 100 } },
            buyer: {},
        });
        const rows = await cmd().func(page, { id: 'https://www.upwork.com/jobs/~022054964136512093518' });
        expect(rows[0].id).toBe('~022054964136512093518');
        expect(rows[0].budget).toBe('$100');
    });

    it('drops zero client score to null', async () => {
        const page = createPageMock({
            ready: true, onLogin: false, challenge: false,
            job: { ciphertext: '~022054964136512093518', title: 'X', type: 2 },
            buyer: { stats: { score: 0, totalJobsWithHires: 0 } },
        });
        const rows = await cmd().func(page, { id: '~022054964136512093518' });
        expect(rows[0].clientRating).toBeNull();
        expect(rows[0].clientHires).toBe(0);
    });

    it('throws AuthRequiredError when redirected to login', async () => {
        const page = createPageMock({ ready: false, onLogin: true, challenge: false, job: null });
        await expect(cmd().func(page, { id: '~022054964136512093518' })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('throws CommandExecutionError on Cloudflare challenge', async () => {
        const page = createPageMock({ ready: false, onLogin: false, challenge: true, job: null });
        await expect(cmd().func(page, { id: '~022054964136512093518' })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('throws EmptyResultError when the store has no job', async () => {
        const page = createPageMock({ ready: false, onLogin: false, challenge: false, job: null });
        await expect(cmd().func(page, { id: '~022054964136512093518' })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('unwraps Browser Bridge envelopes and treats wrong-shape job as parser drift', async () => {
        const rows = await cmd().func(createPageMock({
            session: 'site:upwork',
            data: {
                ready: true,
                onLogin: false,
                challenge: false,
                job: { ciphertext: '~022054964136512093518', title: 'X', type: 1, budget: { amount: 100 } },
                buyer: {},
            },
        }), { id: '~022054964136512093518' });
        expect(rows[0].id).toBe('~022054964136512093518');

        await expect(cmd().func(createPageMock({ ready: true, onLogin: false, challenge: false, job: [] }), { id: '~022054964136512093518' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('fails closed when the detail store belongs to a different ciphertext', async () => {
        const page = createPageMock({
            ready: true,
            onLogin: false,
            challenge: false,
            job: { ciphertext: '~022055605504980235850', title: 'Wrong job' },
            buyer: {},
        });
        await expect(cmd().func(page, { id: '~022054964136512093518' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('rejects malformed ciphertext before opening the page', async () => {
        const page = createPageMock({ ready: true, job: null });
        await expect(cmd().func(page, { id: 'not-an-id' })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });
});
