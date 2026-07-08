import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { __test__ } from './search.js';
import './search.js';

function createPageMock(response) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(response),
    };
}

describe('boss search', () => {
    const command = getRegistry().get('boss/search');

    it('keeps legacy 在校/应届 experience input compatible', () => {
        expect(__test__.resolveMap('在校/应届', __test__.EXP_MAP)).toBe('108');
        expect(__test__.resolveMap('应届', __test__.EXP_MAP)).toBe('102');
    });

    it('fails fast on invalid jobType values', async () => {
        expect(() => __test__.resolveJobType('外包')).toThrow(ArgumentError);
    });

    it('accepts supported jobType labels and raw codes', () => {
        expect(__test__.resolveJobType('全职')).toBe('1901');
        expect(__test__.resolveJobType('实习')).toBe('1902');
        expect(__test__.resolveJobType('兼职')).toBe('1903');
        expect(__test__.resolveJobType('1902')).toBe('1902');
    });

    it('keeps empty query empty and sends jobType filter to the API', async () => {
        const page = createPageMock({
            code: 0,
            zpData: {
                hasMore: false,
                jobList: [
                    {
                        encryptJobId: 'abc',
                        securityId: 'sec',
                        jobName: '前端开发实习生',
                        salaryDesc: '150-200/天',
                        brandName: 'OpenCLI',
                        cityName: '北京',
                        areaDistrict: '海淀区',
                        businessDistrict: '',
                        jobExperience: '在校/应届',
                        jobDegree: '本科',
                        skills: ['JavaScript'],
                        bossName: '张三',
                        bossTitle: '技术负责人',
                        bossOnline: false,
                    },
                ],
            },
        });

        const rows = await command.func(page, {
            query: undefined,
            city: '北京',
            jobType: '实习',
            limit: 1,
            page: 1,
        });

        expect(page.goto).toHaveBeenCalledWith('https://www.zhipin.com/web/geek/job?query=&city=101010100');
        const fetchScript = page.evaluate.mock.calls.at(-1)[0];
        expect(fetchScript).toContain('query=');
        expect(fetchScript).not.toContain('query=undefined');
        expect(fetchScript).toContain('jobType=1902');
        expect(rows[0]).toMatchObject({
            name: '前端开发实习生',
            bossOnline: 'N',
        });
    });
});
