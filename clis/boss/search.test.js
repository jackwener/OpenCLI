import { describe, expect, it, vi } from 'vitest';
import { getRegistry, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';
import { __test__ } from './search.js';
import './search.js';

function createPageMock(response) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        startNetworkCapture: vi.fn().mockResolvedValue(true),
        readNetworkCapture: vi.fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{
                url: 'https://www.zhipin.com/wapi/zpgeek/search/joblist.json',
                responseStatus: 200,
                responsePreview: JSON.stringify(response),
            }]),
    };
}

describe('boss search', () => {
    const command = getRegistry().get('boss/search');

    it('is registered as a read-only intercepted listing command', () => {
        expect(command).toMatchObject({ access: 'read', strategy: Strategy.INTERCEPT });
    });

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

    it('captures the current jobs page response instead of calling the retired API directly', async () => {
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

        expect(page.startNetworkCapture).toHaveBeenCalledWith('joblist.json');
        expect(page.goto.mock.calls[0][0]).toContain('https://www.zhipin.com/web/geek/jobs?query=&city=101010100');
        expect(page.goto.mock.calls[0][0]).toContain('jobType=1902');
        expect(rows[0]).toMatchObject({
            name: '前端开发实习生',
            bossOnline: 'N',
            security_id: 'abc',
        });
    });

    it('validates page and limit instead of silently replacing invalid values', async () => {
        const page = createPageMock({ code: 0, zpData: { hasMore: false, jobList: [] } });
        await expect(command.func(page, { city: '北京', page: 0, limit: 1 })).rejects.toThrow(ArgumentError);
        await expect(command.func(page, { city: '北京', page: 1, limit: 101 })).rejects.toThrow(ArgumentError);
    });

    it('returns the stable empty-result exit category when BOSS has no matching jobs', async () => {
        const page = createPageMock({ code: 0, zpData: { hasMore: false, jobList: [] } });
        await expect(command.func(page, { query: '不存在', city: '北京', page: 1, limit: 1 }))
            .rejects.toThrow(EmptyResultError);
    });

    it('preserves typed auth failures from the captured BOSS response', async () => {
        const page = createPageMock({ code: 7, message: '请登录' });
        await expect(command.func(page, { query: '供应链', city: '北京', page: 1, limit: 1 }))
            .rejects.toThrow(AuthRequiredError);
    });
});
