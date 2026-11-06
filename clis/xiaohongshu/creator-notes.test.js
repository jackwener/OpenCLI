import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import { __test__, parseCreatorNoteIdsFromHtml, parseCreatorNotesText } from './creator-notes.js';
import './creator-notes.js';
function createPageMock(evaluateResult, interceptedRequests = []) {
    const evaluate = Array.isArray(evaluateResult)
        ? vi.fn()
            .mockResolvedValueOnce(evaluateResult[0])
            .mockResolvedValue(evaluateResult[evaluateResult.length - 1])
        : vi.fn().mockResolvedValue(evaluateResult);
    const getInterceptedRequests = Array.isArray(interceptedRequests)
        ? vi.fn().mockResolvedValue(interceptedRequests)
        : vi.fn().mockResolvedValue([]);
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
        getInterceptedRequests,
        getCookies: vi.fn().mockResolvedValue([]),
        screenshot: vi.fn().mockResolvedValue(''),
        waitForCapture: vi.fn().mockResolvedValue(undefined),
    };
}
describe('xiaohongshu creator-notes', () => {
    it('parses creator note text blocks into rows', () => {
        const bodyText = `笔记管理
全部笔记(366)
已发布
测试笔记一
发布于 2025年12月04日 19:45
148208
324
2279
465
32
权限设置
取消置顶
编辑
删除
仅自己可见
测试笔记二
发布于 2026年03月18日 12:39
10
0
0
0
0
权限设置`;
        expect(parseCreatorNotesText(bodyText)).toEqual([
            {
                id: '',
                title: '测试笔记一',
                date: '2025年12月04日 19:45',
                views: 148208,
                likes: 2279,
                collects: 465,
                comments: 324,
                url: '',
            },
            {
                id: '',
                title: '测试笔记二',
                date: '2026年03月18日 12:39',
                views: 10,
                likes: 0,
                collects: 0,
                comments: 0,
                url: '',
            },
        ]);
    });

    it('extracts note ids from creator note-manager html', () => {
        const html = `
      <div>&quot;noteId&quot;:&quot;aaaaaaaaaaaaaaaaaaaaaaaa&quot;</div>
      <div>&quot;noteId&quot;:&quot;dddddddddddddddddddddddd&quot;</div>
      <div>&quot;noteId&quot;:&quot;aaaaaaaaaaaaaaaaaaaaaaaa&quot;</div>
    `;
        expect(parseCreatorNoteIdsFromHtml(html)).toEqual([
            'aaaaaaaaaaaaaaaaaaaaaaaa',
            'dddddddddddddddddddddddd',
        ]);
    });
    it('harvests captured analyze pages in page order and dedupes note ids', () => {
        const captureMap = {
            '/api/galaxy/creator/datacenter/note/analyze/list?type=0&page_size=10&page_num=2': {
                ok: true,
                body: JSON.stringify({
                    data: {
                        total: 3,
                        note_infos: [
                            { id: 'bbbbbbbbbbbbbbbbbbbbbbbb', title: 'page 2' },
                            { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', title: 'duplicate from page 2' },
                        ],
                    },
                }),
            },
            '/api/galaxy/creator/datacenter/note/analyze/list?type=0&page_size=10&page_num=1': {
                ok: true,
                body: JSON.stringify({
                    data: {
                        total: 3,
                        note_infos: [
                            { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', title: 'page 1' },
                        ],
                    },
                }),
            },
        };
        expect(__test__.harvestAnalyzeListCaptures(captureMap)).toEqual({
            total: 3,
            items: [
                { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', title: 'page 1' },
                { id: 'bbbbbbbbbbbbbbbbbbbbbbbb', title: 'page 2' },
            ],
        });
    });
    it('treats incomplete captured pagination as fallback-needed instead of partial success', () => {
        const firstPageItems = Array.from({ length: 10 }, (_, index) => ({
            id: String(index).padStart(24, '0'),
        }));
        expect(__test__.isAnalyzeCaptureComplete(firstPageItems, 25, 20)).toBe(false);
        expect(__test__.isAnalyzeCaptureComplete(firstPageItems, 25, 10)).toBe(true);
        expect(__test__.isAnalyzeCaptureComplete(firstPageItems, 0, 20)).toBe(true);
    });
    it('unwraps browser bridge capture-map envelopes', () => {
        const captureMap = {
            '/api/galaxy/creator/datacenter/note/analyze/list?page_num=1': {
                ok: true,
                body: '{"data":{"total":0,"note_infos":[]}}',
            },
        };
        expect(__test__.parseCaptureMapPayload({ session: 'site:xiaohongshu', data: JSON.stringify(captureMap) })).toEqual(captureMap);
        expect(__test__.parseCaptureMapPayload({ session: 'site:xiaohongshu', data: captureMap })).toEqual(captureMap);
    });
    it('does not fall back to partial DOM rows when captured total proves pagination is incomplete', async () => {
        const cmd = getRegistry().get('xiaohongshu/creator-notes');
        const captureMap = {
            '/api/galaxy/creator/datacenter/note/analyze/list?type=0&page_size=10&page_num=1': {
                ok: true,
                body: JSON.stringify({
                    data: {
                        total: 25,
                        note_infos: Array.from({ length: 10 }, (_, index) => ({
                            id: String(index).padStart(24, '0'),
                            title: `note ${index}`,
                        })),
                    },
                }),
            },
        };
        const page = createPageMock(undefined);
        page.evaluate = vi.fn()
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce(JSON.stringify(captureMap))
            .mockResolvedValueOnce(false);

        await expect(cmd.func(page, { limit: 20 })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    const impression = (id) => `{"noteId":"${id}","type":"normal"}`.replace(/"/g, '&quot;');
    // Sanitized shape of the current note-manager card (#2707).
    const CURRENT_CARD_HTML = `
      <div class="note-card" data-impression="${impression('6954f5e3000000001f0079f9')}">
        <div class="note-card__cover"><img src=""></div>
        <div class="note-card__info">
          <div class="note-card__title">冬日穿搭分享</div>
          <div class="note-card__time">发布于 2026年01月01日 10:30</div>
          <div class="note-card__stats">
            <span class="note-card__stat"><i></i>40104</span>
            <span class="note-card__stat"><i></i>2430</span>
            <span class="note-card__stat"><i></i>692</span>
            <span class="note-card__stat"><i></i>511</span>
            <span class="note-card__stat"><i></i>37</span>
          </div>
        </div>
      </div>`;
    const LEGACY_CARD_HTML = `
      <div class="note" data-impression="${impression('69a1b2c3000000001f00aaaa')}">
        <div class="title">旧版卡片</div>
        <div class="time_status">发布于 2025年12月31日 08:00</div>
        <div class="icon_list"><span class="icon">10</span><span class="icon">2</span><span class="icon">3</span><span class="icon">4</span><span class="icon">0</span></div>
      </div>`;
    function extractCardsFrom(html) {
        const dom = new JSDOM(`<body>${html}</body>`, { url: 'https://creator.xiaohongshu.com/new/note-manager' });
        try {
            return Function('document', `return ${__test__.EXTRACT_NOTE_MANAGER_CARDS_JS}`)(dom.window.document);
        }
        finally {
            dom.window.close();
        }
    }

    it.each([
        ['current .note-card', CURRENT_CARD_HTML, { id: '6954f5e3000000001f0079f9', title: '冬日穿搭分享', date: '2026年01月01日 10:30', metrics: [40104, 2430, 692, 511, 37] }],
        ['legacy div.note', LEGACY_CARD_HTML, { id: '69a1b2c3000000001f00aaaa', title: '旧版卡片', date: '2025年12月31日 08:00', metrics: [10, 2, 3, 4, 0] }],
    ])('extracts note-manager cards from the %s render', (_name, html, expected) => {
        expect(extractCardsFrom(html)).toEqual([expected]);
    });

    it('returns rows from current note-manager cards when capture and direct API both fail', async () => {
        const cmd = getRegistry().get('xiaohongshu/creator-notes');
        const dom = new JSDOM(`<body>${CURRENT_CARD_HTML}</body>`, { url: 'https://creator.xiaohongshu.com/new/note-manager' });
        const page = createPageMock(undefined);
        page.evaluate = vi.fn(async (script) => {
            const source = String(script);
            if (source.includes('function extractNoteManagerCards')) {
                return Function('document', `return ${source}`)(dom.window.document);
            }
            if (source.includes('window.__xhsCapture ||')) return '{}';
            if (source.includes("'HTTP ' + resp.status")) return { error: 'HTTP 406' };
            return undefined;
        });
        try {
            const rows = await cmd.func(page, { limit: 5 });
            expect(page.goto).toHaveBeenLastCalledWith('https://creator.xiaohongshu.com/new/note-manager');
            expect(rows).toEqual([{
                rank: 1,
                id: '6954f5e3000000001f0079f9',
                title: '冬日穿搭分享',
                date: '2026年01月01日 10:30',
                views: 40104,
                likes: 692,
                collects: 511,
                comments: 2430,
                url: 'https://creator.xiaohongshu.com/statistics/note-detail?noteId=6954f5e3000000001f0079f9',
            }]);
        }
        finally {
            dom.window.close();
        }
    });

});
