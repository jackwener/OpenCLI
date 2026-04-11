import { describe, expect, it } from 'vitest';
import { extractScysToc } from './extractors.js';
function createScysTocPageMock(loginState, tocRows) {
    return {
        goto: async () => { },
        wait: async () => { },
        evaluate: async (js) => {
            if (js.includes('const text = (document.body?.innerText ||') && js.includes('hasContentSignals')) {
                return loginState ?? {
                    strongLoginText: false,
                    genericLoginText: false,
                    loginByDom: false,
                    hasContentSignals: true,
                    routeLooksLikeLogin: false,
                };
            }
            if (js.includes('sectionTitleEl.click') || js.includes('sectionTitleEl.dispatchEvent')) {
                return [
                    { entry_type: 'section', section: '预备篇', group: '预备篇', chapter_id: '', chapter_title: '预备篇', status: '', is_current: false },
                    { entry_type: 'chapter', section: '预备篇', group: '图文', chapter_id: '4137', chapter_title: '课程前言', status: '737人学过', is_current: false },
                    { entry_type: 'chapter', section: '预备篇', group: '图文', chapter_id: '4038', chapter_title: '课程目标', status: '508人学过', is_current: true },
                    { entry_type: 'section', section: '基础篇', group: '基础篇', chapter_id: '', chapter_title: '基础篇', status: '', is_current: false },
                    { entry_type: 'chapter', section: '基础篇', group: '一、玩起来！ 通过 AI，10 分钟发布你的第一款网站产品！', chapter_id: '4039', chapter_title: '视频', status: '624人学过', is_current: false },
                    { entry_type: 'chapter', section: '基础篇', group: '一、玩起来！ 通过 AI，10 分钟发布你的第一款网站产品！', chapter_id: '4040', chapter_title: '图文', status: '674人学过', is_current: false },
                ];
            }
            return tocRows ?? [
                { entry_type: 'section', section: '预备篇', group: '预备篇', chapter_id: '', chapter_title: '预备篇', status: '', is_current: false },
                { entry_type: 'chapter', section: '预备篇', group: '图文', chapter_id: '4137', chapter_title: '课程前言', status: '737人学过', is_current: false },
                { entry_type: 'chapter', section: '预备篇', group: '图文', chapter_id: '4038', chapter_title: '课程目标', status: '508人学过', is_current: true },
                { entry_type: 'section', section: '基础篇', group: '基础篇', chapter_id: '', chapter_title: '基础篇', status: '', is_current: false },
            ];
        },
        getCookies: async () => [],
        snapshot: async () => null,
        click: async () => { },
        typeText: async () => { },
        pressKey: async () => { },
        scrollTo: async () => null,
        getFormState: async () => null,
        tabs: async () => [],
        closeTab: async () => { },
        newTab: async () => { },
        selectTab: async () => { },
        networkRequests: async () => [],
        consoleMessages: async () => [],
        scroll: async () => { },
        autoScroll: async () => { },
        installInterceptor: async () => { },
        getInterceptedRequests: async () => [],
        waitForCapture: async () => { },
        screenshot: async () => '',
        getCurrentUrl: async () => 'https://scys.com/course/detail/92',
    };
}
describe('extractScysToc', () => {
    it('expands collapsed sections to recover deterministic chapter ids', async () => {
        const page = createScysTocPageMock();
        const rows = await extractScysToc(page, '92', { waitSeconds: 1 });
        expect(rows.some((row) => row.chapter_id === '4039')).toBe(true);
        expect(rows.some((row) => row.chapter_id === '4040')).toBe(true);
        expect(rows.find((row) => row.chapter_id === '4039')?.group).toBe('一、玩起来！ 通过 AI，10 分钟发布你的第一款网站产品！');
    });
    it('treats login CTA walls as auth failures instead of outdated adapter errors', async () => {
        const page = createScysTocPageMock({
            strongLoginText: false,
            genericLoginText: false,
            loginByDom: false,
            hasContentSignals: false,
            routeLooksLikeLogin: false,
            loginCtaText: true,
        }, []);
        await expect(extractScysToc(page, '92', { waitSeconds: 1 })).rejects.toThrow('SCYS content requires a logged-in browser session');
    });
});
