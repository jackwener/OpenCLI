import { describe, expect, it, vi } from 'vitest';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import { appendAudienceRows, appendTrendRows, parseCreatorNoteDetailDomData, parseCreatorNoteDetailText } from './creator-note-detail.js';
import './creator-note-detail.js';
function createPageMock(evaluateResult) {
    const evaluate = Array.isArray(evaluateResult)
        ? vi.fn()
            .mockResolvedValueOnce(evaluateResult[0])
            .mockResolvedValue(evaluateResult[evaluateResult.length - 1])
        : vi.fn().mockResolvedValue(evaluateResult);
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate,
        snapshot: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
        typeText: vi.fn().mockResolvedValue(undefined),
        pressKey: vi.fn().mockResolvedValue(undefined),
        scrollTo: vi.fn().mockResolvedValue(undefined),
        getFormState: vi.fn().mockResolvedValue({ forms: [], orphanFields: [] }),
        wait: vi.fn().mockResolvedValue(undefined),
        tabs: vi.fn().mockResolvedValue([]),
        selectTab: vi.fn().mockResolvedValue(undefined),
        networkRequests: vi.fn().mockResolvedValue([]),
        consoleMessages: vi.fn().mockResolvedValue([]),
        scroll: vi.fn().mockResolvedValue(undefined),
        autoScroll: vi.fn().mockResolvedValue(undefined),
        installInterceptor: vi.fn().mockResolvedValue(undefined),
        getInterceptedRequests: vi.fn().mockResolvedValue([]),
        getCookies: vi.fn().mockResolvedValue([]),
        screenshot: vi.fn().mockResolvedValue(''),
        waitForCapture: vi.fn().mockResolvedValue(undefined),
    };
}
describe('xiaohongshu creator-note-detail', () => {
    it('parses note detail page text into info and metric rows', () => {
        const bodyText = `笔记数据详情
示例内容复盘
#测试标签
#内容分析
2026-03-18 20:01
切换笔记
笔记诊断
核心数据
观看来源
观众画像
核心数据
基础数据
部分数据统计中，次日可查看
导出数据
曝光数
1733
粉丝占比 6.6%
实时
观看数
544
粉丝占比 7.2%
封面点击率
18.6%
粉丝 19.1%
平均观看时长
51.5秒
粉丝 55.8秒
涨粉数
3
按小时
按天
互动数据
数据实时更新
导出数据
点赞数
19
粉丝占比 60%
评论数
7
粉丝占比 33.3%
收藏数
10
粉丝占比 33.3%
分享数
6
粉丝占比 0%`;
        expect(parseCreatorNoteDetailText(bodyText, 'cccccccccccccccccccccccc')).toEqual([
            { section: '笔记信息', metric: 'note_id', value: 'cccccccccccccccccccccccc', extra: '' },
            { section: '笔记信息', metric: 'title', value: '示例内容复盘', extra: '' },
            { section: '笔记信息', metric: 'published_at', value: '2026-03-18 20:01', extra: '' },
            { section: '基础数据', metric: '曝光数', value: '1733', extra: '粉丝占比 6.6%' },
            { section: '基础数据', metric: '观看数', value: '544', extra: '粉丝占比 7.2%' },
            { section: '基础数据', metric: '封面点击率', value: '18.6%', extra: '粉丝 19.1%' },
            { section: '基础数据', metric: '平均观看时长', value: '51.5秒', extra: '粉丝 55.8秒' },
            { section: '基础数据', metric: '涨粉数', value: '3', extra: '' },
            { section: '互动数据', metric: '点赞数', value: '19', extra: '粉丝占比 60%' },
            { section: '互动数据', metric: '评论数', value: '7', extra: '粉丝占比 33.3%' },
            { section: '互动数据', metric: '收藏数', value: '10', extra: '粉丝占比 33.3%' },
            { section: '互动数据', metric: '分享数', value: '6', extra: '粉丝占比 0%' },
        ]);
    });
    it('parses structured note detail dom data into rows', () => {
        expect(parseCreatorNoteDetailDomData({
            title: '测试笔记一',
            infoText: '测试笔记一\n#测试标签\n2025-12-04 19:45\n切换笔记',
            sections: [
                {
                    title: '基础数据',
                    metrics: [
                        { label: '曝光数', value: '898204', extra: '粉丝占比 0.5%' },
                        { label: '观看数', value: '148284', extra: '粉丝占比 0.6%' },
                        { label: '封面点击率', value: '17.1%', extra: '粉丝 19.1%' },
                        { label: '平均观看时长', value: '30.1秒', extra: '粉丝 17.7秒' },
                        { label: '涨粉数', value: '101', extra: '' },
                    ],
                },
                {
                    title: '互动数据',
                    metrics: [
                        { label: '点赞数', value: '2280', extra: '粉丝占比 3.6%' },
                        { label: '评论数', value: '319', extra: '粉丝占比 9.4%' },
                        { label: '收藏数', value: '466', extra: '粉丝占比 9.4%' },
                        { label: '分享数', value: '33', extra: '粉丝占比 17.7%' },
                    ],
                },
            ],
        }, 'bbbbbbbbbbbbbbbbbbbbbbbb')).toEqual([
            { section: '笔记信息', metric: 'note_id', value: 'bbbbbbbbbbbbbbbbbbbbbbbb', extra: '' },
            { section: '笔记信息', metric: 'title', value: '测试笔记一', extra: '' },
            { section: '笔记信息', metric: 'published_at', value: '2025-12-04 19:45', extra: '' },
            { section: '基础数据', metric: '曝光数', value: '898204', extra: '粉丝占比 0.5%' },
            { section: '基础数据', metric: '观看数', value: '148284', extra: '粉丝占比 0.6%' },
            { section: '基础数据', metric: '封面点击率', value: '17.1%', extra: '粉丝 19.1%' },
            { section: '基础数据', metric: '平均观看时长', value: '30.1秒', extra: '粉丝 17.7秒' },
            { section: '基础数据', metric: '涨粉数', value: '101', extra: '' },
            { section: '互动数据', metric: '点赞数', value: '2280', extra: '粉丝占比 3.6%' },
            { section: '互动数据', metric: '评论数', value: '319', extra: '粉丝占比 9.4%' },
            { section: '互动数据', metric: '收藏数', value: '466', extra: '粉丝占比 9.4%' },
            { section: '互动数据', metric: '分享数', value: '33', extra: '粉丝占比 17.7%' },
        ]);
    });
    it('appends audience source and portrait rows from API payloads', () => {
        const rows = appendAudienceRows([], {
            audienceSource: {
                source: [
                    {
                        title: '首页推荐',
                        value_with_double: 89.9,
                        info: {
                            imp_count: 1469,
                            view_count: 276,
                            interaction_count: 15,
                        },
                    },
                ],
            },
            audienceSourceDetail: {
                gender: [
                    { title: '男性', value: 82 },
                    { title: '女性', value: 18 },
                ],
                age: [
                    { title: '25-34', value: 55 },
                ],
                city: [
                    { title: '上海', value: 8 },
                ],
                interest: [
                    { title: '二次元', value: 13 },
                ],
            },
        });
        expect(rows).toEqual([
            { section: '观看来源', metric: '首页推荐', value: '89.9%', extra: '曝光 1469 · 观看 276 · 互动 15' },
            { section: '观众画像', metric: '性别/男性', value: '82%', extra: '' },
            { section: '观众画像', metric: '性别/女性', value: '18%', extra: '' },
            { section: '观众画像', metric: '年龄/25-34', value: '55%', extra: '' },
            { section: '观众画像', metric: '城市/上海', value: '8%', extra: '' },
            { section: '观众画像', metric: '兴趣/二次元', value: '13%', extra: '' },
        ]);
    });
    it('appends trend summary rows from hour/day series payloads', () => {
        const rows = appendTrendRows([], {
            audienceTrend: {
                no_data: true,
                no_data_tip_msg: '数据统计中，请稍后查看',
            },
            noteBase: {
                hour: {
                    view_list: [
                        { date: new Date('2026-03-18T21:00:00+08:00').getTime(), count: 54 },
                        { date: new Date('2026-03-18T22:00:00+08:00').getTime(), count: 51 },
                    ],
                    like_list: [
                        { date: new Date('2026-03-18T21:00:00+08:00').getTime(), count: 2 },
                    ],
                },
                day: {
                    view_list: [
                        { date: new Date('2026-03-18T00:00:00+08:00').getTime(), count: 307 },
                    ],
                },
            },
        });
        expect(rows).toEqual([
            { section: '趋势说明', metric: '观众趋势', value: '暂不可用', extra: '数据统计中，请稍后查看' },
            { section: '趋势数据', metric: '按小时/观看数', value: '2 points', extra: '03-18 21:00=54 | 03-18 22:00=51' },
            { section: '趋势数据', metric: '按小时/点赞数', value: '1 points', extra: '03-18 21:00=2' },
            { section: '趋势数据', metric: '按天/观看数', value: '1 points', extra: '2026-03-18=307' },
        ]);
    });
    it('navigates to the note detail page and returns parsed rows', async () => {
        const cmd = getRegistry().get('xiaohongshu/creator-note-detail');
        expect(cmd?.func).toBeTypeOf('function');
        const domData = {
            title: '示例笔记',
            infoText: '示例笔记\n2026-03-19 12:00\n切换笔记',
            sections: [
                {
                    title: '基础数据',
                    metrics: [
                        { label: '曝光数', value: '100', extra: '粉丝占比 10%' },
                        { label: '观看数', value: '50', extra: '粉丝占比 20%' },
                        { label: '封面点击率', value: '12%', extra: '粉丝 11%' },
                        { label: '平均观看时长', value: '30秒', extra: '粉丝 31秒' },
                        { label: '涨粉数', value: '2', extra: '' },
                    ],
                },
                {
                    title: '互动数据',
                    metrics: [
                        { label: '点赞数', value: '8', extra: '粉丝占比 25%' },
                        { label: '评论数', value: '1', extra: '粉丝占比 0%' },
                        { label: '收藏数', value: '3', extra: '粉丝占比 50%' },
                        { label: '分享数', value: '0', extra: '粉丝占比 0%' },
                    ],
                },
            ],
        };
        const page = createPageMock(undefined);
        page.evaluate = vi.fn(async (script) => {
            const s = String(script);
            if (s.includes('window.__xhsCapture =')) return undefined;
            if (s.includes('history.pushState')) return undefined;
            if (s.includes('JSON.stringify(window.__xhsCapture')) return JSON.stringify({});
            if (s.includes("document.querySelector('.note-title')")) return domData;
            if (s.includes('document.body.innerText')) return '';
            return undefined;
        });
        const result = await cmd.func(page, { 'note-id': 'demo-note-id' });
        expect(page.goto.mock.calls[0][0]).toBe('https://creator.xiaohongshu.com/statistics');
        expect(page.evaluate.mock.calls[0][0]).toContain('window.__xhsCapture =');
        expect(result).toEqual([
            { section: '笔记信息', metric: 'note_id', value: 'demo-note-id', extra: '' },
            { section: '笔记信息', metric: 'title', value: '示例笔记', extra: '' },
            { section: '笔记信息', metric: 'published_at', value: '2026-03-19 12:00', extra: '' },
            { section: '基础数据', metric: '曝光数', value: '100', extra: '粉丝占比 10%' },
            { section: '基础数据', metric: '观看数', value: '50', extra: '粉丝占比 20%' },
            { section: '基础数据', metric: '封面点击率', value: '12%', extra: '粉丝 11%' },
            { section: '基础数据', metric: '平均观看时长', value: '30秒', extra: '粉丝 31秒' },
            { section: '基础数据', metric: '涨粉数', value: '2', extra: '' },
            { section: '互动数据', metric: '点赞数', value: '8', extra: '粉丝占比 25%' },
            { section: '互动数据', metric: '评论数', value: '1', extra: '粉丝占比 0%' },
            { section: '互动数据', metric: '收藏数', value: '3', extra: '粉丝占比 50%' },
            { section: '互动数据', metric: '分享数', value: '0', extra: '粉丝占比 0%' },
        ]);
    });
    it('polls the capture buffer while the dashboard fires its signed datacenter/note/* requests', async () => {
        const cmd = getRegistry().get('xiaohongshu/creator-note-detail');
        const domData = {
            title: '示例笔记',
            infoText: '示例笔记\n2026-03-19 12:00\n切换笔记',
            sections: [
                {
                    title: '基础数据',
                    metrics: [
                        { label: '曝光数', value: '100', extra: '粉丝占比 10%' },
                        { label: '观看数', value: '50', extra: '粉丝占比 20%' },
                        { label: '封面点击率', value: '12%', extra: '粉丝 11%' },
                        { label: '平均观看时长', value: '30秒', extra: '粉丝 31秒' },
                        { label: '涨粉数', value: '2', extra: '' },
                    ],
                },
                {
                    title: '互动数据',
                    metrics: [
                        { label: '点赞数', value: '8', extra: '粉丝占比 25%' },
                        { label: '评论数', value: '1', extra: '粉丝占比 0%' },
                        { label: '收藏数', value: '3', extra: '粉丝占比 50%' },
                        { label: '分享数', value: '0', extra: '粉丝占比 0%' },
                    ],
                },
            ],
        };
        const page = createPageMock(undefined);
        page.evaluate = vi.fn(async (script) => {
            const s = String(script);
            if (s.includes('window.__xhsCapture =')) return undefined;
            if (s.includes('history.pushState')) return undefined;
            if (s.includes('JSON.stringify(window.__xhsCapture')) return JSON.stringify({});
            if (s.includes("document.querySelector('.note-title')")) return domData;
            return undefined;
        });
        await cmd.func(page, { 'note-id': 'demo-note-id' });
        // Capture loop polls until the deadline expires (no hits with empty mock).
        expect(page.wait.mock.calls.length).toBeGreaterThanOrEqual(4);
        const captureProbeCalls = page.evaluate.mock.calls.filter(([script]) => String(script).includes('JSON.stringify(window.__xhsCapture'));
        expect(captureProbeCalls.length).toBeGreaterThanOrEqual(1);
    });
    it('matches signed API captures by exact pathname so source/detail cannot shadow source', async () => {
        const cmd = getRegistry().get('xiaohongshu/creator-note-detail');
        const domData = {
            title: '示例笔记',
            infoText: '示例笔记\n2026-03-19 12:00\n切换笔记',
            sections: [
                {
                    title: '基础数据',
                    metrics: [
                        { label: '曝光数', value: '100', extra: '粉丝占比 10%' },
                    ],
                },
            ],
        };
        const detailCapture = [
            'https://creator.xiaohongshu.com/api/galaxy/creator/datacenter/note/audience/source/detail?note_id=demo-note-id',
            {
                status: 200,
                ok: true,
                body: JSON.stringify({ data: { gender: [{ title: '女性', value: 64 }] } }),
            },
        ];
        const sourceCapture = [
            'https://creator.xiaohongshu.com/api/galaxy/creator/datacenter/note/audience/source?note_id=demo-note-id',
            {
                status: 200,
                ok: true,
                body: JSON.stringify({
                    data: {
                        source: [
                            {
                                title: '首页推荐',
                                value_with_double: 88.8,
                                info: { imp_count: 1000, view_count: 400, interaction_count: 20 },
                            },
                        ],
                    },
                }),
            },
        ];
        const baseCapture = [
            'https://creator.xiaohongshu.com/api/galaxy/creator/datacenter/note/base?note_id=demo-note-id',
            {
                status: 200,
                ok: true,
                body: JSON.stringify({ data: { hour: { view_list: [{ date: new Date('2026-03-19T12:00:00+08:00').getTime(), count: 7 }] } } }),
            },
        ];
        const trendCapture = [
            'https://creator.xiaohongshu.com/api/galaxy/creator/datacenter/note/analyze/audience/trend?note_id=demo-note-id',
            {
                status: 200,
                ok: true,
                body: JSON.stringify({ data: { no_data: false, no_data_tip_msg: '趋势可用' } }),
            },
        ];
        for (const orderedCaptures of [
            [detailCapture, sourceCapture, baseCapture, trendCapture],
            [sourceCapture, detailCapture, baseCapture, trendCapture],
        ]) {
            const captureMap = Object.fromEntries(orderedCaptures);
            const page = createPageMock(undefined);
            page.evaluate = vi.fn(async (script) => {
                const s = String(script);
                if (s.includes('window.__xhsCapture =')) return undefined;
                if (s.includes('history.pushState')) return undefined;
                if (s.includes('JSON.stringify(window.__xhsCapture')) return JSON.stringify(captureMap);
                if (s.includes("document.querySelector('.note-title')")) return domData;
                return undefined;
            });
            const result = await cmd.func(page, { 'note-id': 'demo-note-id' });
            expect(result).toEqual(expect.arrayContaining([
                { section: '观看来源', metric: '首页推荐', value: '88.8%', extra: '曝光 1000 · 观看 400 · 互动 20' },
                { section: '观众画像', metric: '性别/女性', value: '64%', extra: '' },
                { section: '趋势数据', metric: '按小时/观看数', value: '1 points', extra: '03-19 12:00=7' },
            ]));
        }
    });
    it('throws a typed error when a captured signed API returns non-2xx', async () => {
        const cmd = getRegistry().get('xiaohongshu/creator-note-detail');
        const captureMap = {
            'https://creator.xiaohongshu.com/api/galaxy/creator/datacenter/note/base?note_id=demo-note-id': {
                status: 406,
                ok: false,
                body: '{"msg":"not acceptable"}',
            },
        };
        const page = createPageMock(undefined);
        page.evaluate = vi.fn(async (script) => {
            const s = String(script);
            if (s.includes('window.__xhsCapture =')) return undefined;
            if (s.includes('history.pushState')) return undefined;
            if (s.includes('JSON.stringify(window.__xhsCapture')) return JSON.stringify(captureMap);
            return null;
        });
        await expect(cmd.func(page, { 'note-id': 'demo-note-id' })).rejects.toBeInstanceOf(CommandExecutionError);
    });
    it('throws a typed error for wrong-shaped signed API payloads instead of falling back to DOM rows', async () => {
        const cmd = getRegistry().get('xiaohongshu/creator-note-detail');
        const domData = {
            title: '示例笔记',
            infoText: '示例笔记\n2026-03-19 12:00\n切换笔记',
            sections: [
                {
                    title: '基础数据',
                    metrics: [
                        { label: '曝光数', value: '100', extra: '粉丝占比 10%' },
                    ],
                },
            ],
        };
        for (const body of [
            JSON.stringify({ data: null }),
            JSON.stringify({ data: [] }),
            JSON.stringify({ data: { source: {} } }),
        ]) {
            const captureMap = {
                'https://creator.xiaohongshu.com/api/galaxy/creator/datacenter/note/audience/source?note_id=demo-note-id': {
                    status: 200,
                    ok: true,
                    body,
                },
            };
            const page = createPageMock(undefined);
            page.evaluate = vi.fn(async (script) => {
                const s = String(script);
                if (s.includes('window.__xhsCapture =')) return undefined;
                if (s.includes('history.pushState')) return undefined;
                if (s.includes('JSON.stringify(window.__xhsCapture')) return JSON.stringify(captureMap);
                if (s.includes("document.querySelector('.note-title')")) return domData;
                return null;
            });
            await expect(cmd.func(page, { 'note-id': 'demo-note-id' })).rejects.toBeInstanceOf(CommandExecutionError);
        }
    });
    it('throws EmptyResultError when the detail page exposes no metrics', async () => {
        const cmd = getRegistry().get('xiaohongshu/creator-note-detail');
        const page = createPageMock(undefined);
        page.evaluate = vi.fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce('笔记数据详情\n暂无数据')
            .mockResolvedValue(null);

        await expect(cmd.func(page, { 'note-id': 'demo-note-id' })).rejects.toBeInstanceOf(EmptyResultError);
    });
});
