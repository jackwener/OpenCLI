import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { JSDOM } from 'jsdom';
import {
    __test__,
    buildScrollHarvestJs,
    buildSearchExtractJs,
    buildScrollUntilJs,
    mergeHarvestedRow,
    noteIdToDate,
    noteKeyFromUrl,
    noteUrlInfo,
    shouldStopScrolling,
    unwrapEvaluateResult,
    usableRowCount,
} from './search.js';

function markVisible(el) {
    el.getBoundingClientRect = () => ({ width: 100, height: 100 });
}
function createPageMock(evaluateResults) {
    const evaluate = vi.fn();
    for (const result of evaluateResults) {
        evaluate.mockResolvedValueOnce(result);
    }
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
function harvestPayload(rows, diag = {}) {
    return {
        rows,
        diag: {
            securityBlock: false,
            stopReason: 'target',
            ...diag,
        },
    };
}
function noteCard({ id, title = '', likes = '0', signed = false, host = 'www.xiaohongshu.com' }) {
    const token = signed ? '?xsec_token=signed-token' : '';
    return `
      <section class="note-item">
        <a class="cover mask" href="https://${host}/explore/${id}${token}"><span>${title}</span></a>
        <div class="title">${title}</div>
        <a class="author" href="/user/profile/author123"><span class="name">作者</span></a>
        <span class="count">${likes}</span>
      </section>
    `;
}
async function runHarvestFrames(frames, { target = frames.length, stallsBeforeAdvance = 0 } = {}) {
    const dom = new JSDOM('<body></body>', {
        url: 'https://www.xiaohongshu.com/search_result?keyword=test',
    });
    const { document } = dom.window;
    const root = document.documentElement;
    const viewport = 600;
    let frameIndex = 0;
    let scrollTop = 0;
    let scrollCalls = 0;
    const scrollDeltas = [];

    const currentFrame = () => frames[frameIndex];
    const render = () => {
        const frame = currentFrame();
        document.body.innerHTML = frame.securityBlock
            ? '<main>请求太频繁，请稍后再试</main>'
            : frame.cards.map(noteCard).join('');
        for (const el of document.querySelectorAll('section.note-item')) markVisible(el);
    };
    render();

    Object.defineProperty(document.body, 'innerText', {
        configurable: true,
        get: () => document.body.textContent || '',
    });
    for (const el of [root, document.body]) {
        Object.defineProperty(el, 'scrollHeight', {
            configurable: true,
            get: () => currentFrame().height,
        });
        Object.defineProperty(el, 'scrollTop', {
            configurable: true,
            get: () => scrollTop,
            set: (value) => { scrollTop = Number(value) || 0; },
        });
    }
    Object.defineProperty(root, 'clientHeight', { configurable: true, value: viewport });
    Object.defineProperty(dom.window, 'innerHeight', { configurable: true, value: viewport });
    Object.defineProperty(dom.window, 'scrollY', { configurable: true, get: () => scrollTop });
    Object.defineProperty(dom.window, 'pageYOffset', { configurable: true, get: () => scrollTop });
    dom.window.scrollBy = (_x, delta) => {
        scrollCalls++;
        scrollDeltas.push(delta);
        if (scrollCalls > stallsBeforeAdvance && frameIndex < frames.length - 1) {
            frameIndex++;
            scrollTop = Math.min(scrollTop + delta, Math.max(0, currentFrame().height - viewport));
            render();
        }
    };

    const immediateTimeout = (resolve) => {
        resolve();
        return 1;
    };
    const script = buildScrollHarvestJs('www.xiaohongshu.com', target, {
        maxRounds: 12,
        budgetMs: 30_000,
        step: 900,
    });
    const result = await Function(
        'document',
        'window',
        'getComputedStyle',
        'setTimeout',
        `return (${script})`,
    )(
        document,
        dom.window,
        dom.window.getComputedStyle.bind(dom.window),
        immediateTimeout,
    );
    return { result, scrollDeltas };
}
describe('xiaohongshu search', () => {
    it('rejects invalid limit before browser navigation', async () => {
        const cmd = getRegistry().get('xiaohongshu/search');
        const page = createPageMock([]);

        await expect(cmd.func(page, { query: '特斯拉', limit: 0 })).rejects.toMatchObject({
            code: 'ARGUMENT',
            message: expect.stringContaining('--limit'),
        });
        expect(page.goto).not.toHaveBeenCalled();
    });
    it('throws a clear error when the search page is blocked by a login wall', async () => {
        const cmd = getRegistry().get('xiaohongshu/search');
        expect(cmd?.func).toBeTypeOf('function');
        const page = createPageMock([
            // First evaluate: MutationObserver wait (login wall detected)
            'login_wall',
        ]);
        await expect(cmd.func(page, { query: '特斯拉', limit: 5 })).rejects.toThrow('Xiaohongshu search results are blocked behind a login wall');
        // No scroll-until / autoScroll call when a login wall is detected early.
        expect(page.evaluate).toHaveBeenCalledTimes(1);
        expect(page.autoScroll).not.toHaveBeenCalled();
    });
    it('unwraps a browser-bridge envelope before handling login-wall wait result', async () => {
        const cmd = getRegistry().get('xiaohongshu/search');
        const page = createPageMock([
            { session: 'site:xiaohongshu', data: 'login_wall' },
        ]);

        await expect(cmd.func(page, { query: '特斯拉', limit: 5 })).rejects.toMatchObject({
            code: 'AUTH_REQUIRED',
            message: expect.stringContaining('blocked behind a login wall'),
        });
        expect(page.evaluate).toHaveBeenCalledTimes(1);
    });
    it('returns ranked results with search_result url and author_url preserved', async () => {
        const cmd = getRegistry().get('xiaohongshu/search');
        expect(cmd?.func).toBeTypeOf('function');
        const detailUrl = 'https://www.xiaohongshu.com/search_result/68e90be80000000004022e66?xsec_token=test-token&xsec_source=';
        const authorUrl = 'https://www.xiaohongshu.com/user/profile/635a9c720000000018028b40?xsec_token=user-token&xsec_source=pc_search';
        const rows = [
            {
                title: '某鱼买FSD被坑了4万',
                author: '随风',
                likes: '261',
                url: detailUrl,
                author_url: authorUrl,
            },
        ];
        const page = createPageMock([
            // First evaluate: MutationObserver wait (content appeared)
            'content',
            // Second evaluate: scroll + harvest through Browser Bridge envelope.
            { session: 'site:xiaohongshu', data: harvestPayload(rows) },
        ]);
        const result = await cmd.func(page, { query: '特斯拉', limit: 1 });
        // Should only do one goto (the search page itself), no per-note detail navigation
        expect(page.goto.mock.calls).toHaveLength(1);
        expect(result).toEqual([
            {
                rank: 1,
                title: '某鱼买FSD被坑了4万',
                author: '随风',
                likes: '261',
                published_at: '2025-10-10',
                url: detailUrl,
                author_url: authorUrl,
            },
        ]);
    });
    it('fails typed instead of silently returning [] for malformed extraction payloads', async () => {
        const cmd = getRegistry().get('xiaohongshu/search');
        const page = createPageMock([
            'content',
            { session: 'site:xiaohongshu', data: { rows: 'nope' } },
        ]);

        await expect(cmd.func(page, { query: '测试', limit: 1 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('payload shape'),
        });
    });
    it('fails typed instead of silently dropping malformed harvest rows', async () => {
        const cmd = getRegistry().get('xiaohongshu/search');
        const page = createPageMock([
            'content',
            harvestPayload([null]),
        ]);

        await expect(cmd.func(page, { query: '测试', limit: 1 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('harvest row 1 shape'),
        });
    });
    it('fails typed instead of emitting untrusted harvest row URLs', async () => {
        const cmd = getRegistry().get('xiaohongshu/search');
        const page = createPageMock([
            'content',
            harvestPayload([
                {
                    title: '外站结果',
                    author: 'UserA',
                    likes: '10',
                    url: 'https://evil.example/explore/68e90be80000000004022e66',
                    author_url: '',
                },
            ]),
        ]);

        await expect(cmd.func(page, { query: '测试', limit: 1 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('trusted note URL'),
        });
    });
    it('fails typed for malformed wait envelopes and raw bridge failures', async () => {
        const cmd = getRegistry().get('xiaohongshu/search');
        const malformedPage = createPageMock([{ session: 'site:xiaohongshu', data: { state: 'content' } }]);
        await expect(cmd.func(malformedPage, { query: '测试', limit: 1 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('wait payload'),
        });

        const failedPage = createPageMock([]);
        failedPage.evaluate.mockRejectedValueOnce(new Error('bridge disconnected'));
        await expect(cmd.func(failedPage, { query: '测试', limit: 1 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('bridge disconnected'),
        });
    });
    it('maps a harvested risk-control interstitial to SECURITY_BLOCK', async () => {
        const cmd = getRegistry().get('xiaohongshu/search');
        const page = createPageMock([
            'timeout',
            harvestPayload([], { securityBlock: true, stopReason: 'security-block' }),
        ]);

        await expect(cmd.func(page, { query: '测试', limit: 5 })).rejects.toMatchObject({
            code: 'SECURITY_BLOCK',
        });
    });
    it('filters out results with no title and respects the limit', async () => {
        const cmd = getRegistry().get('xiaohongshu/search');
        expect(cmd?.func).toBeTypeOf('function');
        const page = createPageMock([
            // First evaluate: MutationObserver wait (content appeared)
            'content',
            // Second evaluate: scroll + harvest result.
            harvestPayload([
                    {
                        title: 'Result A',
                        author: 'UserA',
                        likes: '10',
                        url: 'https://www.xiaohongshu.com/search_result/68e90be80000000004022e66',
                        author_url: '',
                    },
                    {
                        title: '',
                        author: 'UserB',
                        likes: '5',
                        url: 'https://www.xiaohongshu.com/search_result/697f6c74000000002103de17',
                        author_url: '',
                    },
                    {
                        title: 'Result C',
                        author: 'UserC',
                        likes: '3',
                        url: 'https://www.xiaohongshu.com/search_result/69b739f00000000000000000',
                        author_url: '',
                    },
                ]),
        ]);
        const result = (await cmd.func(page, { query: '测试', limit: 1 }));
        // limit=1 should return only the first valid-titled result
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ rank: 1, title: 'Result A' });
    });
    it('waits for content via MutationObserver before extracting', async () => {
        const cmd = getRegistry().get('xiaohongshu/search');
        expect(cmd?.func).toBeTypeOf('function');
        const page = createPageMock([
            // First evaluate: MutationObserver wait (content appeared)
            'content',
            // Second evaluate: scroll + harvest completes with no rows.
            harvestPayload([], { stopReason: 'exhausted' }),
        ]);
        const result = (await cmd.func(page, { query: '测试等待', limit: 5 }));
        expect(result).toHaveLength(0);
        // Only one navigation, no retry
        expect(page.goto).toHaveBeenCalledTimes(1);
        // Two evaluate calls: wait, then the single scroll + harvest IIFE.
        expect(page.evaluate).toHaveBeenCalledTimes(2);
    });
});
describe('buildSearchExtractJs', () => {
    it('separates fallback author text from appended relative date', () => {
        const dom = new JSDOM(`
          <section class="note-item">
            <a class="cover mask" href="/search_result/68e90be80000000004022e66?xsec_token=test-token"></a>
            <div class="title">数字作者测试</div>
            <a class="author" href="/user/profile/author123">
              <span>数字3天前端</span><span>3天前</span>
            </a>
            <span class="count">8</span>
          </section>
        `, { url: 'https://www.xiaohongshu.com/search_result?keyword=test' });
        markVisible(dom.window.document.querySelector('section.note-item'));
        const script = buildSearchExtractJs('www.xiaohongshu.com');
        const result = Function('document', 'getComputedStyle', `return (${script})`)(dom.window.document, dom.window.getComputedStyle.bind(dom.window));

        expect(result[0]).toMatchObject({
            title: '数字作者测试',
            author: '数字3天前端',
            likes: '8',
            author_url: 'https://www.xiaohongshu.com/user/profile/author123',
        });
    });
});
describe('noteKeyFromUrl', () => {
    it('extracts a 24-character note id from supported paths', () => {
        expect(noteKeyFromUrl('https://www.xiaohongshu.com/search_result/68e90be80000000004022e66?xsec_token=a')).toBe('68e90be80000000004022e66');
        expect(noteKeyFromUrl('https://www.xiaohongshu.com/explore/68E90BE80000000004022E66')).toBe('68e90be80000000004022e66');
        expect(noteKeyFromUrl('https://www.xiaohongshu.com/note/68e90be80000000004022e66/')).toBe('68e90be80000000004022e66');
    });
    it('returns an empty key when no supported note id is present', () => {
        expect(noteKeyFromUrl('https://www.xiaohongshu.com/user/profile/635a9c720000000018028b40')).toBe('');
        expect(noteKeyFromUrl('')).toBe('');
    });
    it('binds note identity and signed-token provenance to the expected host', () => {
        const id = '68e90be80000000004022e66';
        expect(noteKeyFromUrl(`https://evil.example/explore/${id}`, 'www.xiaohongshu.com')).toBe('');
        expect(noteUrlInfo(`http://www.xiaohongshu.com/explore/${id}?xsec_token=token`, 'www.xiaohongshu.com'))
            .toEqual({ key: '', signed: false });
        expect(noteUrlInfo(`https://www.xiaohongshu.com/explore/${id}?xsec_token=`, 'www.xiaohongshu.com'))
            .toEqual({ key: id, signed: false });
        expect(noteUrlInfo(`https://www.xiaohongshu.com/explore/${id}?xsec_token=token`, 'www.xiaohongshu.com'))
            .toEqual({ key: id, signed: true });
    });
});
describe('mergeHarvestedRow', () => {
    const noteId = '68e90be80000000004022e66';
    const unsignedUrl = `https://www.xiaohongshu.com/explore/${noteId}`;
    const signedUrl = `https://www.xiaohongshu.com/search_result/${noteId}?xsec_token=signed`;
    const webHost = 'www.xiaohongshu.com';

    it('backfills an empty title from a later render', () => {
        const acc = new Map();
        mergeHarvestedRow(acc, { title: '', author: '', likes: '0', url: unsignedUrl, author_url: '' }, webHost);
        mergeHarvestedRow(acc, { title: '后渲染标题', author: '作者', likes: '7', url: signedUrl, author_url: '/user/profile/a' }, webHost);
        expect(acc.get(noteId)).toMatchObject({
            title: '后渲染标题',
            author: '作者',
            author_url: '/user/profile/a',
        });
    });
    it('does not overwrite a non-empty title', () => {
        const acc = new Map();
        mergeHarvestedRow(acc, { title: '原始标题', author: '', likes: '1', url: unsignedUrl, author_url: '' }, webHost);
        mergeHarvestedRow(acc, { title: '后续标题', author: '', likes: '2', url: signedUrl, author_url: '' }, webHost);
        expect(acc.get(noteId).title).toBe('原始标题');
    });
    it("backfills likes when the placeholder value is '0'", () => {
        const acc = new Map();
        mergeHarvestedRow(acc, { title: '标题', author: '', likes: '0', url: unsignedUrl, author_url: '' }, webHost);
        mergeHarvestedRow(acc, { title: '标题', author: '', likes: '42', url: signedUrl, author_url: '' }, webHost);
        expect(acc.get(noteId).likes).toBe('42');
    });
    it('upgrades an unsigned URL to a signed xsec_token URL', () => {
        const acc = new Map();
        mergeHarvestedRow(acc, { title: '标题', author: '', likes: '1', url: unsignedUrl, author_url: '' }, webHost);
        mergeHarvestedRow(acc, { title: '标题', author: '', likes: '1', url: signedUrl, author_url: '' }, webHost);
        expect(acc.get(noteId).url).toBe(signedUrl);
    });
    it('does not downgrade a signed URL to an unsigned URL', () => {
        const acc = new Map();
        mergeHarvestedRow(acc, { title: '标题', author: '', likes: '1', url: signedUrl, author_url: '' }, webHost);
        mergeHarvestedRow(acc, { title: '标题', author: '', likes: '1', url: unsignedUrl, author_url: '' }, webHost);
        expect(acc.get(noteId).url).toBe(signedUrl);
    });
    it('deduplicates different token URLs for the same note id', () => {
        const acc = new Map();
        mergeHarvestedRow(acc, { title: '标题', author: '', likes: '1', url: `${signedUrl}-a`, author_url: '' }, webHost);
        mergeHarvestedRow(acc, { title: '标题', author: '', likes: '1', url: `${signedUrl}-b`, author_url: '' }, webHost);
        expect(acc.size).toBe(1);
    });
    it('rejects an untrusted-host row instead of letting it collide by note id', () => {
        const acc = new Map();
        expect(mergeHarvestedRow(acc, {
            title: '外站',
            author: '',
            likes: '1',
            url: `https://evil.example/explore/${noteId}`,
            author_url: '',
        }, webHost)).toBe(false);
        expect(acc.size).toBe(0);
    });
});
describe('usableRowCount', () => {
    it('counts only rows that survive the post-harvest title filter', () => {
        // Regression lock: a --limit 100 run stopped at collected=100 but emitted
        // 84 rows, because 16 cards had not rendered their title yet when the
        // target check fired.
        const acc = new Map();
        acc.set('a', { title: '有标题', url: 'https://www.xiaohongshu.com/explore/a' });
        acc.set('b', { title: '', url: 'https://www.xiaohongshu.com/explore/b' });
        acc.set('c', { url: 'https://www.xiaohongshu.com/explore/c' });
        expect(usableRowCount(acc)).toBe(1);
    });
    it('returns zero for an empty accumulator', () => {
        expect(usableRowCount(new Map())).toBe(0);
    });
});
describe('shouldStopScrolling', () => {
    const baseState = {
        collected: 5,
        target: 100,
        round: 3,
        maxRounds: 30,
        elapsedMs: 5_000,
        budgetMs: 60_000,
        atBottom: false,
        idleRounds: 0,
    };

    it('does not stop for a row plateau while scroll geometry still changes', () => {
        // Regression lock: the old plateau rule exited at scrollTop=4500 / scrollHeight=6960.
        expect(shouldStopScrolling({ ...baseState, idleRounds: 0 })).toEqual({ stop: false, reason: '' });
    });
    it('stops when the target count is collected', () => {
        expect(shouldStopScrolling({ ...baseState, collected: 100 })).toEqual({ stop: true, reason: 'target' });
    });
    it('stops when the time budget is exhausted', () => {
        expect(shouldStopScrolling({ ...baseState, elapsedMs: 60_000 })).toEqual({ stop: true, reason: 'budget' });
    });
    it('stops when the maximum round count is reached', () => {
        expect(shouldStopScrolling({ ...baseState, round: 30 })).toEqual({ stop: true, reason: 'max-rounds' });
    });
    it('stops after repeated stalls at the real bottom', () => {
        expect(shouldStopScrolling({ ...baseState, atBottom: true, idleRounds: 3 })).toEqual({ stop: true, reason: 'exhausted' });
    });
    it('stops after repeated stalls when scrolling is wedged', () => {
        expect(shouldStopScrolling({ ...baseState, idleRounds: 3 })).toEqual({ stop: true, reason: 'wedged' });
    });
});
describe('buildScrollHarvestJs', () => {
    it('keeps the largest harvest budget below the 60s Browser Bridge evaluate deadline', () => {
        expect(__test__.harvestOptionsForLimit(100).budgetMs).toBe(45_000);
    });
    it('harvests virtualized frames, backfills staged fields, and never skips beyond one viewport', async () => {
        const a = '68e90be80000000004022e66';
        const b = '697f6c74000000002103de17';
        const c = '69b739f00000000000000000';
        const { result, scrollDeltas } = await runHarvestFrames([
            { height: 1200, cards: [{ id: a, title: '', likes: '0' }] },
            {
                height: 1800,
                cards: [
                    { id: a, title: '后渲染标题', likes: '7', signed: true },
                    { id: b, title: '第二屏', likes: '0' },
                ],
            },
            { height: 2400, cards: [{ id: c, title: '第三屏', likes: '3' }] },
        ], { target: 3 });

        expect(result.diag).toMatchObject({ usable: 3, stopReason: 'target', securityBlock: false });
        expect(result.rows.map((row) => row.title)).toEqual(['后渲染标题', '第二屏', '第三屏']);
        expect(result.rows[0]).toMatchObject({ likes: '7' });
        expect(result.rows[0].url).toContain('xsec_token=signed-token');
        expect(scrollDeltas.length).toBeGreaterThan(0);
        expect(Math.max(...scrollDeltas)).toBeLessThanOrEqual(600);
    });
    it('survives two slow no-movement rounds when later height/data progress arrives', async () => {
        const { result } = await runHarvestFrames([
            { height: 600, cards: [{ id: '68e90be80000000004022e66', title: '第一屏' }] },
            { height: 1200, cards: [{ id: '697f6c74000000002103de17', title: '慢加载第二屏' }] },
        ], { target: 2, stallsBeforeAdvance: 2 });

        expect(result.rows.map((row) => row.title)).toEqual(['第一屏', '慢加载第二屏']);
        expect(result.diag).toMatchObject({ usable: 2, stopReason: 'target' });
    });
    it('stops only after stable idle rounds at the real bottom', async () => {
        const { result } = await runHarvestFrames([
            { height: 600, cards: [{ id: '68e90be80000000004022e66', title: '唯一结果' }] },
        ], { target: 5 });

        expect(result.rows).toHaveLength(1);
        expect(result.diag).toMatchObject({ usable: 1, stopReason: 'exhausted', rounds: 4 });
    });
    it('detects a security block before spending the scroll budget', async () => {
        const { result } = await runHarvestFrames([
            { height: 600, cards: [], securityBlock: true },
        ], { target: 5 });

        expect(result.rows).toEqual([]);
        expect(result.diag).toMatchObject({ securityBlock: true, stopReason: 'security-block', rounds: 1 });
    });
    it('rejects invalid targetCount and maxRounds arguments', () => {
        expect(() => buildScrollHarvestJs('www.xiaohongshu.com', 0)).toThrow(/targetCount/);
        expect(() => buildScrollHarvestJs('www.xiaohongshu.com', 10, { maxRounds: 0 })).toThrow(/maxRounds/);
    });
});
describe('buildScrollUntilJs', () => {
    it('inlines the target count and default maxScrolls into the generated IIFE', () => {
        const js = buildScrollUntilJs(40);
        // Target count must drive the early-exit check (#1471: --limit > 13 was capped).
        expect(js).toContain('countItems() >= 40');
        // Default safety cap of 15 to bound runtime on infinite-scroll pages.
        expect(js).toContain('i < 15');
        // Plateau detection so the loop exits early when XHS stops lazy-loading
        // instead of spinning all 15 iterations against an exhausted feed.
        expect(js).toContain('plateauRounds');
        // Related-search rows must not count toward the target.
        expect(js).toContain("classList.contains('query-note-item')");
    });
    it('respects a custom maxScrolls override', () => {
        const js = buildScrollUntilJs(100, 5);
        expect(js).toContain('countItems() >= 100');
        expect(js).toContain('i < 5');
    });
    it('counts only visible real note rows', async () => {
        const dom = new JSDOM(`
          <section class="note-item" id="visible"></section>
          <section class="note-item query-note-item" id="query"></section>
          <section class="note-item" id="hidden" style="display:none"></section>
        `, { url: 'https://www.xiaohongshu.com/search_result?keyword=test' });
        markVisible(dom.window.document.querySelector('#visible'));
        markVisible(dom.window.document.querySelector('#query'));
        markVisible(dom.window.document.querySelector('#hidden'));

        const result = await Function('document', 'window', 'MutationObserver', 'getComputedStyle', `return (${buildScrollUntilJs(1)})`)(dom.window.document, dom.window, dom.window.MutationObserver, dom.window.getComputedStyle.bind(dom.window));

        expect(result).toBe(1);
    });
    it('rejects unsafe helper arguments instead of interpolating them into code', () => {
        expect(() => buildScrollUntilJs(0)).toThrow(/targetCount/);
        expect(() => buildScrollUntilJs(10, 0)).toThrow(/maxScrolls/);
    });
});
describe('stripXhsAuthorDateSuffix', () => {
    it('only strips trailing date suffixes and preserves date-like author text', () => {
        expect(__test__.stripXhsAuthorDateSuffix('作者名 3天前')).toBe('作者名');
        expect(__test__.stripXhsAuthorDateSuffix('作者名2026-04-01')).toBe('作者名');
        expect(__test__.stripXhsAuthorDateSuffix('3天前端工程师')).toBe('3天前端工程师');
        expect(__test__.stripXhsAuthorDateSuffix('刚刚好')).toBe('刚刚好');
        expect(__test__.stripXhsAuthorDateSuffix('刚刚')).toBe('刚刚');
    });
});
describe('noteIdToDate (ObjectID timestamp parsing)', () => {
    it('parses a known note ID to the correct China-timezone date', () => {
        // 0x697f6c74 = 1769958516 → 2026-02-01 in UTC+8
        expect(noteIdToDate('https://www.xiaohongshu.com/search_result/697f6c74000000002103de17')).toBe('2026-02-01');
        // 0x68e90be8 → 2025-10-10 in UTC+8
        expect(noteIdToDate('https://www.xiaohongshu.com/explore/68e90be80000000004022e66')).toBe('2025-10-10');
    });
    it('returns China date when UTC+8 crosses into the next day', () => {
        // 0x69b739f0 = 2026-03-15 23:00 UTC = 2026-03-16 07:00 CST
        // Without UTC+8 offset this would incorrectly return 2026-03-15
        expect(noteIdToDate('https://www.xiaohongshu.com/search_result/69b739f00000000000000000')).toBe('2026-03-16');
    });
    it('handles /note/ path variant', () => {
        expect(noteIdToDate('https://www.xiaohongshu.com/note/697f6c74000000002103de17')).toBe('2026-02-01');
    });
    it('handles URL with query parameters', () => {
        expect(noteIdToDate('https://www.xiaohongshu.com/search_result/697f6c74000000002103de17?xsec_token=abc')).toBe('2026-02-01');
    });
    it('returns empty string for non-matching URLs', () => {
        expect(noteIdToDate('https://www.xiaohongshu.com/user/profile/635a9c720000000018028b40')).toBe('');
        expect(noteIdToDate('https://www.xiaohongshu.com/')).toBe('');
    });
    it('returns empty string for IDs shorter than 24 hex chars', () => {
        expect(noteIdToDate('https://www.xiaohongshu.com/search_result/abcdef')).toBe('');
    });
    it('returns empty string when timestamp is out of range', () => {
        // All zeros → ts = 0
        expect(noteIdToDate('https://www.xiaohongshu.com/search_result/000000000000000000000000')).toBe('');
    });
});
describe('unwrapEvaluateResult (browser-bridge envelope normalization)', () => {
    it('returns the raw array unchanged when payload is already an array', () => {
        const arr = [{ title: 'a' }, { title: 'b' }];
        expect(unwrapEvaluateResult(arr)).toBe(arr);
    });
    it('unwraps { session, data: [...] } envelope to the inner array', () => {
        const arr = [{ title: 'a' }];
        const env = { session: 'site:xiaohongshu:abc', data: arr };
        expect(unwrapEvaluateResult(env)).toBe(arr);
    });
    it('unwraps primitive data from Browser Bridge envelopes', () => {
        expect(unwrapEvaluateResult({ session: 'site:xiaohongshu:abc', data: 'login_wall' })).toBe('login_wall');
    });
    it('passes non-envelope objects through unchanged', () => {
        const obj = { results: [], loginWall: true };
        expect(unwrapEvaluateResult(obj)).toBe(obj);
    });
    it('handles null and undefined safely', () => {
        expect(unwrapEvaluateResult(null)).toBe(null);
        expect(unwrapEvaluateResult(undefined)).toBe(undefined);
    });
    it('unwraps non-array envelope data so callers can validate the payload shape', () => {
        const env = { session: 'x', data: { not: 'an array' } };
        expect(unwrapEvaluateResult(env)).toEqual({ not: 'an array' });
    });
});
