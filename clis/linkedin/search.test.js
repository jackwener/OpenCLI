import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

import { ArgumentError, AuthRequiredError } from '@jackwener/opencli/errors';
import { __test__ } from './search.js';

const {
    parseCsvArg,
    parseIntegerArg,
    mapFilterValues,
    decodeLinkedinRedirect,
    looksLinkedInAuthWallText,
    enrichJobDetails,
    findJobDescriptionRoot,
    buildVoyagerUrl,
    EXPERIENCE_LEVELS,
    JOB_TYPES,
    DATE_POSTED,
    REMOTE_TYPES,
} = __test__;

describe('linkedin parseCsvArg', () => {
    it('returns empty array for empty / null / undefined', () => {
        expect(parseCsvArg(undefined)).toEqual([]);
        expect(parseCsvArg(null)).toEqual([]);
        expect(parseCsvArg('')).toEqual([]);
    });

    it('splits and trims comma-separated values', () => {
        expect(parseCsvArg('full-time, contract')).toEqual(['full-time', 'contract']);
        expect(parseCsvArg(' a , b , , c ')).toEqual(['a', 'b', 'c']);
    });
});

describe('linkedin mapFilterValues', () => {
    it('maps known values to upstream codes and dedupes', () => {
        expect(mapFilterValues('full-time, contract, full', JOB_TYPES, 'job_type')).toEqual(['F', 'C']);
        expect(mapFilterValues('remote, hybrid', REMOTE_TYPES, 'remote')).toEqual(['2', '3']);
    });

    it('throws ArgumentError on unknown filter values (no silent drop)', () => {
        expect(() => mapFilterValues('martian', JOB_TYPES, 'job_type')).toThrow(ArgumentError);
        expect(() => mapFilterValues('full-time, ufo', JOB_TYPES, 'job_type')).toThrow(ArgumentError);
    });

    it('returns empty array for empty input', () => {
        expect(mapFilterValues('', EXPERIENCE_LEVELS, 'experience_level')).toEqual([]);
        expect(mapFilterValues(undefined, DATE_POSTED, 'date_posted')).toEqual([]);
    });
});

describe('linkedin argument validation', () => {
    it('rejects --limit outside 1..100 instead of silently clamping', () => {
        expect(() => parseIntegerArg(0, '--limit', 10, 1, 100)).toThrow(ArgumentError);
        expect(() => parseIntegerArg(101, '--limit', 10, 1, 100)).toThrow(ArgumentError);
        expect(() => parseIntegerArg('10.5', '--limit', 10, 1, 100)).toThrow(ArgumentError);
    });

    it('rejects negative --start instead of silently clamping to zero', () => {
        expect(() => parseIntegerArg(-1, '--start', 0, 0)).toThrow(ArgumentError);
        expect(parseIntegerArg(undefined, '--start', 0, 0)).toBe(0);
        expect(parseIntegerArg('25', '--start', 0, 0)).toBe(25);
    });

});

describe('linkedin auth wall detection', () => {
    it('recognizes login/authwall signals', () => {
        expect(looksLinkedInAuthWallText('https://www.linkedin.com/authwall?trk=guest Sign in to continue')).toBe(true);
        expect(looksLinkedInAuthWallText('LinkedIn Login, Sign in')).toBe(true);
        expect(looksLinkedInAuthWallText('About the job Senior infrastructure engineer')).toBe(false);
    });

});

describe('linkedin decodeLinkedinRedirect', () => {
    it('extracts the underlying url from a /redir/redirect/ wrapper', () => {
        const target = 'https://example.com/jobs/apply?id=42';
        const wrapped = `https://www.linkedin.com/redir/redirect/?url=${encodeURIComponent(target)}&source=jobs`;
        expect(decodeLinkedinRedirect(wrapped)).toBe(target);
    });

    it('returns the input unchanged for non-redirect urls', () => {
        const direct = 'https://example.com/jobs/42/';
        expect(decodeLinkedinRedirect(direct)).toBe(direct);
    });

    it('returns empty string for falsy input', () => {
        expect(decodeLinkedinRedirect('')).toBe('');
        expect(decodeLinkedinRedirect(null)).toBe('');
    });
});

describe('linkedin enrichJobDetails (silent failure fix)', () => {
    function makeFakePage({ evaluateResults = [], gotoFails = [], evaluateFails = [] } = {}) {
        let evalCall = 0;
        let gotoCall = 0;
        return {
            goto: vi.fn(async () => {
                if (gotoFails[gotoCall++]) {
                    throw new Error(gotoFails[gotoCall - 1]);
                }
            }),
            wait: vi.fn(async () => undefined),
            evaluate: vi.fn(async () => {
                const idx = evalCall++;
                if (evaluateFails[idx]) throw new Error(evaluateFails[idx]);
                return evaluateResults[idx];
            }),
        };
    }

    it('surfaces detail_error="no url" when row has no URL (instead of silent empty string)', async () => {
        const page = makeFakePage();
        const out = await enrichJobDetails(page, [
            { rank: 1, title: 'No URL Job', company: 'X', url: '' },
        ]);
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({
            description: null,
            apply_url: null,
            detail_error: 'no url',
        });
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('surfaces detail_error="fetch failed: ..." when goto throws (no silent swallow)', async () => {
        const page = makeFakePage({ gotoFails: ['network down'] });
        const out = await enrichJobDetails(page, [
            { rank: 1, title: 'Fetch Fail', company: 'X', url: 'https://www.linkedin.com/jobs/view/1' },
        ]);
        expect(out).toHaveLength(1);
        expect(out[0].description).toBeNull();
        expect(out[0].apply_url).toBeNull();
        expect(out[0].detail_error).toMatch(/^fetch failed: .*network down/);
    });

    it('surfaces detail_error="missing description" on empty description (signals upstream gap, not crash)', async () => {
        const page = makeFakePage({
            evaluateResults: [
                false, // auth wall probe
                true, // description wait
                undefined, // expand-show-more click result (ignored)
                { description: '', applyUrl: '' },
            ],
        });
        const out = await enrichJobDetails(page, [
            { rank: 1, title: 'Empty Desc', company: 'X', url: 'https://www.linkedin.com/jobs/view/2' },
        ]);
        expect(out[0].description).toBeNull();
        expect(out[0].apply_url).toBeNull();
        expect(out[0].detail_error).toBe('missing description');
    });

    it('surfaces detail_error=null on a fully successful enrichment', async () => {
        const page = makeFakePage({
            evaluateResults: [
                false, // auth wall probe
                true, // description wait
                undefined,
                { description: '  An interesting role  ', applyUrl: 'https://example.com/apply' },
            ],
        });
        const out = await enrichJobDetails(page, [
            { rank: 1, title: 'OK', company: 'X', url: 'https://www.linkedin.com/jobs/view/3' },
        ]);
        expect(out[0]).toMatchObject({
            description: 'An interesting role',
            apply_url: 'https://example.com/apply',
            detail_error: null,
        });
    });

    it('processes multiple rows with mixed outcomes without aborting the batch', async () => {
        const page = makeFakePage({
            evaluateResults: [
                // Row 1 (success)
                false,
                true,
                undefined,
                { description: 'Good', applyUrl: 'https://a.example/' },
                // Row 3 (success — row 2 had no URL so didn't navigate)
                false,
                true,
                undefined,
                { description: 'Also good', applyUrl: 'https://b.example/' },
            ],
        });
        const out = await enrichJobDetails(page, [
            { rank: 1, title: 'A', company: 'X', url: 'https://www.linkedin.com/jobs/view/10' },
            { rank: 2, title: 'B', company: 'X', url: '' },
            { rank: 3, title: 'C', company: 'X', url: 'https://www.linkedin.com/jobs/view/30' },
        ]);
        expect(out).toHaveLength(3);
        expect(out[0].detail_error).toBeNull();
        expect(out[1].detail_error).toBe('no url');
        expect(out[2].detail_error).toBeNull();
        // Goto was only called for rows with URL (1 and 3)
        expect(page.goto).toHaveBeenCalledTimes(2);
    });

    it('throws AuthRequiredError on detail auth wall instead of burying it in detail_error', async () => {
        const page = makeFakePage({ evaluateResults: [true] });

        await expect(enrichJobDetails(page, [
            { rank: 1, title: 'Needs Auth', company: 'X', url: 'https://www.linkedin.com/jobs/view/4' },
        ])).rejects.toBeInstanceOf(AuthRequiredError);
    });
});

function voyagerSearchInput(overrides = {}) {
    return {
        keywords: 'accountant',
        location: '',
        companyIds: [],
        experienceLevels: [],
        jobTypes: [],
        datePostedValues: [],
        remoteTypes: [],
        ...overrides,
    };
}

// The query value LinkedIn sees after one round of URL decoding.
function decodedQuery(apiPath) {
    return new URL('https://www.linkedin.com' + apiPath).searchParams.get('query');
}

describe('linkedin voyager search Rest.li escaping (#2714)', () => {
    it('keeps the comma in a "City, Country" location inside the value', () => {
        const url = buildVoyagerUrl(voyagerSearchInput({ location: 'São Paulo, Brazil' }), 0, 10);
        expect(url).toContain('location:S%C3%A3o%20Paulo%252C%20Brazil');
        const query = decodedQuery(url);
        expect(query).toBe('(origin:JOB_SEARCH_PAGE_OTHER_ENTRY,keywords:accountant,'
            + 'locationUnion:(seoLocation:(location:São Paulo%2C Brazil)),spellCorrectionEnabled:true)');
    });

    it('escapes a literal %2C so it is not read back as a comma', () => {
        const query = decodedQuery(buildVoyagerUrl(voyagerSearchInput({
            keywords: 'growth 100%2C',
            location: 'Austin %2C TX',
        }), 0, 10));
        expect(query).toContain('keywords:growth 100%252C,');
        expect(query).toContain('location:Austin %252C TX)');
    });

    it('escapes parentheses, colons and apostrophes in keywords', () => {
        const query = decodedQuery(buildVoyagerUrl(voyagerSearchInput({
            keywords: "O'Reilly (C++): staff",
        }), 0, 10));
        expect(query).toContain('keywords:O%27Reilly %28C++%29%3A staff,');
    });

    it('leaves the Rest.li structure and filters unescaped', () => {
        const url = buildVoyagerUrl(voyagerSearchInput({
            location: 'Seattle, WA',
            jobTypes: ['F', 'C'],
        }), 25, 10);
        expect(url).toContain('query=(origin:JOB_SEARCH_PAGE_JOB_FILTER,keywords:accountant,locationUnion:(seoLocation:(location:');
        expect(url).toContain(',selectedFilters:(jobType:List(F,C)),spellCorrectionEnabled:true)&start=25');
    });
});

describe('linkedin job description lookup (localized UI, #2714)', () => {
    const descriptionText = (html) => {
        const root = findJobDescriptionRoot(new JSDOM(html).window.document);
        return root ? (root.id || root.className) : null;
    };

    it('uses the most specific container led by the English heading', () => {
        expect(descriptionText(`
          <main><div><h1>Accountant</h1><div class="outer">
            <div class="about"><h2>About the job</h2><p>Reconcile ledgers.</p></div>
          </div></div></main>`)).toBe('about');
    });

    it('falls back to the description container when the heading is localized', () => {
        expect(descriptionText(`
          <main><h1>Contador</h1>
            <div class="jobs-description__content"><div id="job-details">
              <h2>Sobre a vaga</h2><p>Conciliar contas.</p>
            </div></div>
          </main>`)).toBe('jobs-description__content');
    });

    it('returns null while no description is rendered', () => {
        expect(descriptionText('<main><h1>Contador</h1><div id="job-details"></div></main>')).toBeNull();
    });

    it('does not need English text for the description wait', async () => {
        const page = {
            goto: vi.fn(async () => undefined),
            wait: vi.fn(async (options) => {
                if (typeof options === 'object' && options.text) throw new Error('Text not found: ' + options.text);
            }),
            evaluate: vi.fn()
                .mockResolvedValueOnce(false) // auth wall probe
                .mockResolvedValueOnce(true) // description wait
                .mockResolvedValueOnce(undefined) // expand
                .mockResolvedValueOnce({ description: 'Sobre a vaga Conciliar contas.', applyUrl: '' }),
        };
        const out = await enrichJobDetails(page, [
            { rank: 1, title: 'Contador', company: 'X', url: 'https://www.linkedin.com/jobs/view/5' },
        ]);
        expect(out[0]).toMatchObject({ description: 'Sobre a vaga Conciliar contas.', detail_error: null });
        expect(page.wait).not.toHaveBeenCalledWith(expect.objectContaining({ text: expect.anything() }));
    });
});
