import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getRegistry, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { __test__ as jobsTest } from './jobs.js';
import { __test__ as searchTest } from './search.js';
import { __test__ as chatsTest } from './chats.js';
import { __test__ as resumeTest } from './resume.js';
import { __test__ as downloadTest } from './download-resume.js';
import './jobs.js';
import './search.js';
import './chats.js';
import './request-resume.js';
import './resume.js';
import './download-resume.js';

function browserPage() {
    return {
        getCookies: vi.fn().mockResolvedValue([
            { name: 'session', value: 'synthetic-session' },
            { name: 'XSRF-TOKEN', value: 'csrf%3Dtoken' },
        ]),
    };
}

function jsonResponse(payload) {
    return {
        ok: true,
        json: vi.fn().mockResolvedValue(payload),
    };
}

describe('liepin recruiting commands', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('registers the read and write boundaries explicitly', () => {
        const registry = getRegistry();
        for (const name of ['jobs', 'search', 'chats', 'resume']) {
            expect(registry.get(`liepin/${name}`)).toMatchObject({
                access: 'read',
                strategy: Strategy.COOKIE,
                browser: true,
            });
        }
        for (const name of ['request-resume', 'download-resume']) {
            expect(registry.get(`liepin/${name}`)).toMatchObject({
                access: 'write',
                strategy: Strategy.COOKIE,
                browser: true,
            });
        }
    });

    it('builds the official talent-search form and maps a synthetic candidate', () => {
        expect(searchTest.searchInput('生鲜 定价', 2)).toMatchObject({
            keys: '生鲜 定价',
            showKeys: '生鲜 定价',
            curPage: 1,
            workyears: '0,99',
            interactiveVersion: 'v2',
        });
        expect(searchTest.mapCandidate({
            resIdEncode: 'synthetic-resume-id',
            oppositeImId: 'synthetic-im-id',
            showName: '候选人',
            activeStatus: '近期活跃',
            showAge: '34岁',
            workYearsShow: '9年',
            eduLevelShow: '本科',
            dqName: '广州',
            jobWant: { wantTitle: '价格策略' },
            workExpList: [{ rwdCompname: '示例零售公司', rwdsTitle: '经营分析' }],
        }, 0)).toEqual({
            rank: 1,
            resume_id: 'synthetic-resume-id',
            opposite_im_id: 'synthetic-im-id',
            name: '候选人',
            active_status: '近期活跃',
            age: '34岁',
            work_years: '9年',
            degree: '本科',
            location: '广州',
            desired_title: '价格策略',
            latest_company: '示例零售公司',
            latest_title: '经营分析',
            url: 'https://lpt.liepin.com/resume/detail?resIdEncode=synthetic-resume-id',
        });
    });

    it('searches visible talent cards from the logged-in browser page', async () => {
        const command = getRegistry().get('liepin/search');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn()
                .mockResolvedValueOnce(undefined)
                .mockResolvedValueOnce([{
                    rank: 1,
                    resume_id: 'resume-id',
                    name: '候选人',
                    summary: '生鲜价格策略',
                }]),
        };
        const rows = await command.func(page, { query: '生鲜 定价', page: 1, limit: 10 });
        expect(rows).toHaveLength(1);
        expect(page.goto).toHaveBeenCalledWith('https://lpt.liepin.com/search', { settleMs: 3000 });
        expect(page.evaluate.mock.calls[0][1]).toBe('生鲜 定价');

        page.evaluate.mockReset().mockResolvedValueOnce(undefined).mockResolvedValueOnce([]);
        await expect(command.func(page, { query: '生鲜', page: 1, limit: 10 }))
            .rejects.toThrow(EmptyResultError);
    }, 10_000);

    it('maps jobs, chats, and resume summaries without scalar sentinels', () => {
        expect(jobsTest.mapJob({ ejobId: 123, ejobTitle: '生鲜价格策略专家' })).toEqual({
            job_id: '123',
            title: '生鲜价格策略专家',
            location: null,
            status: null,
            applicants: null,
            updated_at: null,
        });
        expect(chatsTest.mapChat({
            oppositeImId: 'im-id',
            showName: '候选人',
            lastMessage: { content: '已发送简历', sendTime: '刚刚' },
        })).toMatchObject({
            opposite_im_id: 'im-id',
            name: '候选人',
            latest_message: '已发送简历',
            latest_at: '刚刚',
        });
        expect(resumeTest.mapResume({
            data: {
                resumeData: {
                    resIdEncode: 'resume-id',
                    basicInfo: { showName: '候选人', eduLevelShow: '本科' },
                    jobWant: { wantTitle: '定价策略' },
                },
            },
        }, 'requested-id')).toMatchObject({
            resume_id: 'resume-id',
            name: '候选人',
            degree: '本科',
            desired_title: '定价策略',
        });
    });

    it('requires explicit confirmation before requesting a resume', async () => {
        const command = getRegistry().get('liepin/request-resume');
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(command.func(browserPage(), {
            oppositeImId: 'synthetic-im-id',
            confirm: false,
        })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();

        fetchMock.mockResolvedValueOnce(jsonResponse({ flag: 1, msg: '成功' }));
        const rows = await command.func(browserPage(), {
            oppositeImId: 'synthetic-im-id',
            confirm: true,
        });
        expect(rows).toEqual([{
            status: 'sent',
            opposite_im_id: 'synthetic-im-id',
            biz_type: 3,
            message: '成功',
        }]);
        expect(fetchMock.mock.calls[0][1].body.get('bizType')).toBe('3');
    });

    it('validates formats and downloads an exported resume without overwriting by default', async () => {
        expect(downloadTest.normalizeFormat('PDF')).toBe('pdf');
        expect(() => downloadTest.normalizeFormat('txt')).toThrow(ArgumentError);

        const directory = await mkdtemp(join(tmpdir(), 'opencli-liepin-'));
        try {
            const fetchMock = vi.fn()
                .mockResolvedValueOnce(jsonResponse({ flag: 1, data: {} }))
                .mockResolvedValueOnce(jsonResponse({ flag: 1, data: { objectId: '?synthetic-object' } }))
                .mockResolvedValueOnce({
                    ok: true,
                    arrayBuffer: vi.fn().mockResolvedValue(Uint8Array.from([1, 2, 3]).buffer),
                });
            vi.stubGlobal('fetch', fetchMock);
            const command = getRegistry().get('liepin/download-resume');
            const rows = await command.func(browserPage(), {
                resumeId: 'synthetic-resume-id',
                'resume-format': 'pdf',
                output: directory,
                jobId: '',
                applyId: '',
                overwrite: false,
            });
            expect(rows[0]).toMatchObject({
                resume_id: 'synthetic-resume-id',
                format: 'pdf',
                bytes: 3,
            });
            expect(await readFile(rows[0].path)).toEqual(Buffer.from([1, 2, 3]));
            await expect(command.func(browserPage(), {
                resumeId: 'synthetic-resume-id',
                'resume-format': 'pdf',
                output: directory,
                overwrite: false,
            })).rejects.toThrow(ArgumentError);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
});
