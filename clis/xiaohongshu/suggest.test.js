import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { JSDOM } from 'jsdom';
import { buildSuggestExtractJs } from './suggest.js';

function markVisible(el) {
    el.getBoundingClientRect = () => ({ width: 80, height: 28, top: 0, left: 0 });
}

// Shape captured from both the classic /search_result and the AI /search_result_ai layouts
// on 2026-10-18: a refinement tab row under the filter bar (first tab is the active base
// query) and one or more "大家都在搜" blocks interleaved with the note cards.
function resultPageMarkup({ tags = ['综合', '何同学', '原理', '图纸'], trending = [['中文机械打字机', '林语堂的明快打字机'], ['有中文打字机吗', '林语堂的明快打字机']] } = {}) {
    const tabRow = tags.map((tag, index) => `<button class="tab${index === 0 ? ' active' : ''}"><span>${tag}</span></button>`).join('');
    const blocks = trending.map((items) => `
      <div class="query-note-wrapper">
        <div class="query-note-header"><span class="query-note-header-text">大家都在搜</span></div>
        <div class="query-note-list">
          ${items.map((item) => `<div class="query-note-item"><div class="item-wrapper"><img class="item-cover" src="about:blank"><span class="item-text">${item}</span></div></div>`).join('')}
        </div>
      </div>`).join('');
    return `
      <div class="reds-sticky-box sticky tag-search-sticky-ai">
        <div class="scroll-container tab-scroll-container"><div class="content-container">${tabRow}</div></div>
      </div>
      <div class="feeds-container">
        <section class="note-item"><a href="/search_result/68e90be80000000004022e66">note</a></section>
        ${blocks}
      </div>`;
}

function runExtract(markup) {
    const dom = new JSDOM(`<body>${markup}</body>`, { url: 'https://www.xiaohongshu.com/search_result?keyword=test' });
    const { document } = dom.window;
    for (const tab of document.querySelectorAll('.tab')) markVisible(tab);
    return Function('document', `return (${buildSuggestExtractJs()})`)(document);
}

describe('xiaohongshu suggest extraction', () => {
    it('lists refinement tags first, then trending queries, skipping the active base tab', () => {
        expect(runExtract(resultPageMarkup())).toEqual([
            { suggestion: '何同学', type: 'refinement' },
            { suggestion: '原理', type: 'refinement' },
            { suggestion: '图纸', type: 'refinement' },
            { suggestion: '中文机械打字机', type: 'trending' },
            { suggestion: '林语堂的明快打字机', type: 'trending' },
            { suggestion: '有中文打字机吗', type: 'trending' },
        ]);
    });

    it('ignores collapsed tab rows and blank items instead of emitting empty suggestions', () => {
        const dom = new JSDOM(`<body>${resultPageMarkup({ tags: ['综合', '原理', ''], trending: [['', '测评']] })}</body>`);
        const { document } = dom.window;
        const tabs = [...document.querySelectorAll('.tab')];
        markVisible(tabs[1]);
        // tabs[2] stays 0x0 (collapsed/offscreen render)
        const rows = Function('document', `return (${buildSuggestExtractJs()})`)(document);
        expect(rows).toEqual([
            { suggestion: '原理', type: 'refinement' },
            { suggestion: '测评', type: 'trending' },
        ]);
    });

    it('returns no rows when the page has neither block', () => {
        expect(runExtract('<section class="note-item"><a href="/explore/x">x</a></section>')).toEqual([]);
    });
});

function createSuggestPage(extractResult) {
    const evaluate = vi.fn(async (script) => {
        const source = String(script);
        if (source.includes('search-icon')) return { status: 'ok', detail: '/search_result' };
        if (source.includes('findNoteCard')) return 'content';
        if (source.includes('query-note-item')) return extractResult;
        throw new Error(`Unexpected evaluate script: ${source.slice(0, 40)}`);
    });
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate,
    };
}

describe('xiaohongshu suggest command', () => {
    it('opens the in-site search like `search` and returns ranked rows with the declared columns', async () => {
        const cmd = getRegistry().get('xiaohongshu/suggest');
        expect(cmd?.func).toBeTypeOf('function');
        expect(cmd.columns).toEqual(['rank', 'suggestion', 'type']);
        expect(cmd.access).toBe('read');
        const page = createSuggestPage([
            { suggestion: '何同学', type: 'refinement' },
            { suggestion: '中文机械打字机', type: 'trending' },
        ]);
        const rows = await cmd.func(page, { query: '明快打字机', limit: 20 });
        expect(rows).toEqual([
            { rank: 1, suggestion: '何同学', type: 'refinement' },
            { rank: 2, suggestion: '中文机械打字机', type: 'trending' },
        ]);
        expect(page.goto).toHaveBeenCalledWith('https://www.xiaohongshu.com/explore');
        expect(page.evaluate.mock.calls.map(([script]) => String(script).includes('search-icon'))).toContain(true);
    });

    it('applies --limit after ranking and rejects an invalid limit before navigating', async () => {
        const cmd = getRegistry().get('xiaohongshu/suggest');
        const page = createSuggestPage([
            { suggestion: 'a', type: 'refinement' },
            { suggestion: 'b', type: 'refinement' },
            { suggestion: 'c', type: 'trending' },
        ]);
        expect(await cmd.func(page, { query: 'q', limit: 2 })).toHaveLength(2);
        const untouched = createSuggestPage([]);
        await expect(cmd.func(untouched, { query: 'q', limit: 0 })).rejects.toMatchObject({ code: 'ARGUMENT' });
        expect(untouched.goto).not.toHaveBeenCalled();
    });

    it('fails typed when the result page renders neither refinement tags nor trending queries', async () => {
        const cmd = getRegistry().get('xiaohongshu/suggest');
        await expect(cmd.func(createSuggestPage([]), { query: 'q', limit: 20 })).rejects.toMatchObject({ code: 'EMPTY_RESULT' });
    });

    it('fails typed on a malformed extraction payload instead of emitting partial rows', async () => {
        const cmd = getRegistry().get('xiaohongshu/suggest');
        await expect(cmd.func(createSuggestPage([{ suggestion: 'ok', type: 'refinement' }, { nope: true }]), { query: 'q', limit: 20 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('shape') });
    });

    it('maps a login wall during the content wait to AUTH_REQUIRED', async () => {
        const cmd = getRegistry().get('xiaohongshu/suggest');
        const page = createSuggestPage([]);
        page.evaluate.mockImplementation(async (script) => {
            const source = String(script);
            if (source.includes('search-icon')) return { status: 'ok', detail: '/search_result' };
            if (source.includes('findNoteCard')) return 'login_wall';
            throw new Error('unexpected');
        });
        await expect(cmd.func(page, { query: 'q', limit: 20 })).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    });
});
