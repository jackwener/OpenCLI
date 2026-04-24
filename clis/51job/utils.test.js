import { describe, expect, it, vi } from 'vitest';
import { CliError } from '@jackwener/opencli/errors';
import { parseCompanyJobCard, pageFetchJson, resolveCity } from './utils.js';

describe('51job resolveCity', () => {
    it('maps known city names and explicit national scope', () => {
        expect(resolveCity('杭州')).toBe('080200');
        expect(resolveCity('all')).toBe('000000');
        expect(resolveCity('000000')).toBe('000000');
    });

    it('rejects unknown non-empty inputs instead of silently widening to 全国', () => {
        expect(() => resolveCity('杭州z')).toThrowError(CliError);
        expect(() => resolveCity('杭州z')).toThrow(/Unknown city\/area/);
    });
});

describe('51job pageFetchJson', () => {
    it('detects WAF challenge HTML and throws ANTI_BOT', async () => {
        const page = {
            evaluate: vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                text: '<html><title>slider</title></html>',
            }),
        };

        await expect(pageFetchJson(page, 'https://we.51job.com/api/job/search-pc')).rejects.toMatchObject({
            code: 'ANTI_BOT',
        });
    });
});

describe('51job parseCompanyJobCard', () => {
    it('parses sensorsdata JSON into a stable row fragment', () => {
        const row = parseCompanyJobCard({
            href: 'https://jobs.51job.com/shanghai/123456789.html',
            sensorsdata: JSON.stringify({
                jobId: '123456789',
                jobTitle: 'Senior Engineer',
                jobSalary: '20-30K',
                jobArea: '上海',
                jobYear: '3-5年',
                jobDegree: '本科',
                funcType: '后端开发',
                jobTime: '04-22',
            }),
        });

        expect(row).toEqual({
            jobId: '123456789',
            title: 'Senior Engineer',
            salary: '20-30K',
            city: '上海',
            workYear: '3-5年',
            degree: '本科',
            funcType: '后端开发',
            issueDate: '04-22',
            url: 'https://jobs.51job.com/shanghai/123456789.html',
        });
    });

    it('returns null on malformed sensorsdata', () => {
        expect(parseCompanyJobCard({
            href: 'https://jobs.51job.com/shanghai/123456789.html',
            sensorsdata: '{bad json}',
        })).toBeNull();
    });
});
