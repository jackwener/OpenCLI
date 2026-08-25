import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError } from '@jackwener/opencli/errors';
import { __test__ } from './recommend.js';
import './recommend.js';

describe('liepin recommend', () => {
    const command = getRegistry().get('liepin/recommend');

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('registers a read-only cookie-backed command', () => {
        expect(command).toMatchObject({ access: 'read', strategy: Strategy.COOKIE });
    });

    it('validates limit and jobId instead of silently replacing invalid values', () => {
        expect(__test__.normalizeLimit(undefined)).toBe(20);
        expect(__test__.normalizeLimit(1)).toBe(1);
        expect(() => __test__.normalizeLimit(0)).toThrow(ArgumentError);
        expect(() => __test__.normalizeLimit(21)).toThrow(ArgumentError);
        expect(__test__.normalizeJobId('50774103')).toBe('50774103');
        expect(() => __test__.normalizeJobId('job-1')).toThrow(ArgumentError);
    });

    it('builds the same initial recommendation query used by the recruiter page', () => {
        expect(__test__.recommendInput('50774103')).toEqual({
            pageSize: 20,
            ejobId: '50774103',
            siftConditionVo: __test__.DEFAULT_FILTER,
            queryKind: '5',
            operateKind: 'LOGIN',
        });
    });

    it('maps candidate data without scalar sentinels or private fixture values', () => {
        const row = __test__.mapCandidate({
            resIdEncode: 'resume-encoded-id',
            resume: {
                showName: '候选人',
                activeStatus: '今天活跃',
                showAge: '35岁',
                workYearsShow: '10年',
                eduLevelShow: '本科',
                cityName: '广州',
                label: ['供应链', '数据分析'],
                url: '/resume/detail?resIdEncode=resume-encoded-id',
                jobWant: {
                    wantDqName: '深圳',
                    wantTitle: '策略运营',
                    wantSalary: '30-50K',
                },
                workExpList: [{ rwdCompname: '示例公司', rwdsTitle: '运营负责人' }],
            },
        }, 0);

        expect(row).toEqual({
            rank: 1,
            resume_id: 'resume-encoded-id',
            name: '候选人',
            active_status: '今天活跃',
            age: '35岁',
            work_years: '10年',
            degree: '本科',
            location: '广州',
            desired_location: '深圳',
            desired_title: '策略运营',
            desired_salary: '30-50K',
            skills: '供应链, 数据分析',
            latest_company: '示例公司',
            latest_title: '运营负责人',
            url: 'https://lpt.liepin.com/resume/detail?resIdEncode=resume-encoded-id',
        });
    });

    it('uses null for legitimately absent optional fields', () => {
        const row = __test__.mapCandidate({ resume: { enresId: 'id', workExpList: [] } }, 0);
        expect(row.name).toBeNull();
        expect(row.latest_company).toBeNull();
        expect(row.url).toBe('https://lpt.liepin.com/resume/detail?resIdEncode=id');
    });

    it('recovers the resume ID from its detail URL when the endpoint omits it', () => {
        const row = __test__.mapCandidate({
            resume: {
                url: '/resume/detail?resIdEncode=url-derived-id',
                workExpList: [],
            },
        }, 0);
        expect(row.resume_id).toBe('url-derived-id');
    });

    it('uses browser cookies and the init-selected job for the read-only API flow', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                json: vi.fn().mockResolvedValue({ flag: 1, data: { ejobId: 50774103 } }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: vi.fn().mockResolvedValue({
                    flag: 1,
                    data: {
                        list: [{
                            resIdEncode: 'resume-id',
                            resume: {
                                showName: '候选人',
                                label: [],
                                workExpList: [],
                            },
                        }],
                    },
                }),
            });
        vi.stubGlobal('fetch', fetchMock);
        const page = {
            getCookies: vi.fn().mockResolvedValue([
                { name: 'session', value: 'browser-session' },
                { name: 'XSRF-TOKEN', value: 'csrf%3Dtoken' },
            ]),
        };

        const rows = await command.func(page, { jobId: '', limit: 1 });

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ rank: 1, resume_id: 'resume-id', name: '候选人' });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[0][0]).toContain('recommend.init');
        expect(fetchMock.mock.calls[0][1].headers['X-XSRF-TOKEN']).toBe('csrf=token');
        const query = JSON.parse(fetchMock.mock.calls[1][1].body.get('lpRecommendQueryInputVo'));
        expect(query).toMatchObject({ ejobId: '50774103', queryKind: '5', operateKind: 'LOGIN' });
    });

    it('maps Liepin login failures to the stable auth error category', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({ flag: 0, code: '-1401', msg: '请登录' }),
        }));
        const page = {
            getCookies: vi.fn().mockResolvedValue([{ name: 'session', value: 'expired' }]),
        };

        await expect(command.func(page, { jobId: '', limit: 1 })).rejects.toThrow(AuthRequiredError);
    });
});
