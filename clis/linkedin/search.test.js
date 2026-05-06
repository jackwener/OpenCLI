import { describe, expect, it, vi } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { __test__ } from './search.js';

const {
    parseCsvArg,
    mapFilterValues,
    decodeLinkedinRedirect,
    enrichJobDetails,
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
                undefined,
                { description: 'Good', applyUrl: 'https://a.example/' },
                // Row 3 (success — row 2 had no URL so didn't navigate)
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
});
