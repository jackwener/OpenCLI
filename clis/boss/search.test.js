import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import { __test__ } from './search.js';

const command = getRegistry().get('boss/search');
const LIVE_CAPTURE = JSON.parse(readFileSync(
    new URL('./__fixtures__/search-joblist.capture.json', import.meta.url),
    'utf8',
));

function makeJob(id) {
    return {
        encryptJobId: id,
        jobName: `Job ${id}`,
        salaryDesc: '20-30K',
        brandName: 'OpenCLI',
        cityName: '深圳',
        areaDistrict: '南山区',
        businessDistrict: '科技园',
        jobExperience: '1-3年',
        jobDegree: '本科',
        skills: ['Python'],
        bossName: '张女士',
        bossTitle: 'HR',
        bossOnline: true,
    };
}

function success(ids, hasMore) {
    return {
        status: 200,
        text: JSON.stringify({
            code: 0,
            zpData: {
                jobList: ids.map(makeJob),
                hasMore,
            },
        }),
    };
}

function createPage(responses) {
    const evaluate = vi.fn();
    for (const response of responses)
        evaluate.mockResolvedValueOnce(response);
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate,
    };
}

describe('boss search', () => {
    it('keeps legacy 在校/应届 experience input compatible', () => {
        expect(__test__.resolveMap('在校/应届', __test__.EXP_MAP)).toBe('108');
        expect(__test__.resolveMap('应届', __test__.EXP_MAP)).toBe('102');
    });

    it('fails fast on invalid jobType values', async () => {
        expect(() => __test__.resolveJobType('外包')).toThrow(ArgumentError);
    });

    it('fails fast on unknown city names instead of silently searching Beijing', () => {
        expect(() => __test__.resolveCity('不存在的城市')).toThrow(ArgumentError);
    });

    it('accepts supported jobType labels and raw codes', () => {
        expect(__test__.resolveJobType('全职')).toBe('1901');
        expect(__test__.resolveJobType('实习')).toBe('1902');
        expect(__test__.resolveJobType('兼职')).toBe('1903');
        expect(__test__.resolveJobType('1902')).toBe('1902');
    });

    it('passes the requested --page directly in the joblist POST body', async () => {
        const page = createPage([success(['page-two-job'], false)]);

        const rows = await command.func(page, {
            query: 'Python',
            city: '深圳',
            page: 2,
            limit: 15,
        });

        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.goto.mock.calls[0][0]).toContain('/web/geek/jobs?');
        expect(page.goto.mock.calls[0][0]).not.toContain('page=');
        expect(page.evaluate).toHaveBeenCalledTimes(1);
        expect(page.evaluate.mock.calls[0][0]).toBeTypeOf('function');
        expect(page.evaluate.mock.calls[0][1].url).toContain('joblist.json?_=');
        expect(Object.fromEntries(page.evaluate.mock.calls[0][1].form)).toMatchObject({
            page: '2',
            pageSize: '15',
            city: '101280600',
            query: 'Python',
            scene: '1',
        });
        expect(rows.map(row => row.security_id)).toEqual(['page-two-job']);
    });

    it('requests two API pages in source order when limit is 30', async () => {
        const pageOneIds = Array.from({ length: 15 }, (_, i) => `page-1-${i + 1}`);
        const pageTwoIds = Array.from({ length: 15 }, (_, i) => `page-2-${i + 1}`);
        const page = createPage([
            success(pageOneIds, true),
            success(pageTwoIds, true),
        ]);

        const rows = await command.func(page, {
            query: 'Python',
            city: '深圳',
            page: 1,
            limit: 30,
        });

        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.evaluate).toHaveBeenCalledTimes(2);
        expect(page.evaluate.mock.calls.map(call => Object.fromEntries(call[1].form).page)).toEqual(['1', '2']);
        expect(rows.map(row => row.security_id)).toEqual([...pageOneIds, ...pageTwoIds]);
    });

    it('deduplicates IDs across pages without sorting the API result', async () => {
        const page = createPage([
            success(['job-b', 'job-a', 'job-c'], true),
            success(['job-a', 'job-d'], false),
        ]);

        const rows = await command.func(page, {
            query: 'Python',
            city: '深圳',
            page: 1,
            limit: 4,
        });

        expect(page.evaluate.mock.calls.map(call => Object.fromEntries(call[1].form).page)).toEqual(['1', '2']);
        expect(rows.map(row => row.security_id)).toEqual(['job-b', 'job-a', 'job-c', 'job-d']);
    });

    it('parses two cropped authenticated live pages without reordering', async () => {
        const page = createPage(LIVE_CAPTURE.pages.map(payload => ({
            status: 200,
            text: JSON.stringify(payload),
        })));

        const rows = await command.func(page, {
            query: 'Java',
            city: '深圳',
            page: 1,
            limit: 6,
        });

        expect(page.evaluate.mock.calls.map(call => Object.fromEntries(call[1].form).page)).toEqual(['1', '2']);
        expect(rows.map(row => row.security_id)).toEqual([
            'fixture-job-1',
            'fixture-job-2',
            'fixture-job-3',
            'fixture-job-4',
            'fixture-job-5',
            'fixture-job-6',
        ]);
        expect(rows[0]).toMatchObject({
            name: 'Example job',
            area: '深圳',
            experience: '1-3年',
            degree: '本科',
        });
    });

    it('stops after a short page when hasMore is false', async () => {
        const page = createPage([success(['job-1', 'job-2'], false)]);

        const rows = await command.func(page, {
            query: 'Python',
            city: '深圳',
            page: 1,
            limit: 30,
        });

        expect(page.evaluate).toHaveBeenCalledTimes(1);
        expect(rows).toHaveLength(2);
    });

    it('returns an empty-result error when the requested page is out of range', async () => {
        const page = createPage([success([], false)]);

        await expect(command.func(page, {
            query: 'Python',
            city: '深圳',
            page: 99,
            limit: 15,
        })).rejects.toThrow(EmptyResultError);
    });

});
