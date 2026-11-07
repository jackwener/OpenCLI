import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { __test__, buildSearchExtractJs, command, mergeHarvestedRow } from './search.js';

const webHost = 'www.xiaohongshu.com';
const noteId = '68e90be80000000004022e66';
const url = `https://${webHost}/explore/${noteId}`;
const otherId = '68e90be80000000004022e67';
const otherUrl = `https://${webHost}/search_result/${otherId}`;

// These are synthetic, token-free DOM fixtures. The saved trace tree drops SVG
// names, so these tests deliberately do not invent a recognized symbol name or
// an unobserved Vue/Pinia search-store schema.
function extract(metrics = '', host = webHost) {
    const dom = new JSDOM(`
      <section class="note-item">
        <a class="cover mask" href="https://${host}/explore/${noteId}"></a>
        <div class="title">指标合同离线样本</div>
        <a class="author" href="/user/profile/offline-author"><span class="name">作者</span></a>
        ${metrics}
      </section>
    `, { url: `https://${host}/search_result?sort=collect_descending`, runScripts: 'outside-only' });
    const card = dom.window.document.querySelector('section');
    card.getBoundingClientRect = () => ({ width: 200, height: 250, top: 0 });
    try {
        return dom.window.eval(buildSearchExtractJs(host))[0];
    }
    finally {
        dom.window.close();
    }
}

function row(metrics = {}) {
    return { title: '离线样本', author: '作者', likes: '', collects: '', comments: '', url, author_url: '', ...metrics };
}

describe('search metric extraction contract', () => {
    it('keeps every unavailable count as an empty string', () => {
        expect(extract()).toMatchObject({ likes: '', collects: '', comments: '' });
    });

    it.each(['296', '收藏', '0', '   '])('does not infer a metric from an unidentified count %j or URL sort', (text) => {
        expect(extract(`<span class="count">${text}</span>`))
            .toMatchObject({ likes: '', collects: '', comments: '' });
    });

    it('does not treat the trace collection container as a like count', () => {
        const result = extract('<span id="note-page-collect-board-guide"><svg></svg><span class="count">296</span></span>');
        expect(result).toMatchObject({ likes: '', collects: '296', comments: '' });
    });

    it('reads the observed collection zero label without inventing zero likes', () => {
        expect(extract('<span id="note-page-collect-board-guide"><span class="count">收藏</span></span>'))
            .toMatchObject({ likes: '', collects: '0', comments: '' });
    });

    it('reads an explicit legacy like source even after a collection or generic count', () => {
        expect(extract(`
          <span class="count">999</span>
          <span id="note-page-collect-board-guide"><span class="count">296</span></span>
          <span class="like-count">243</span>
        `)).toMatchObject({ likes: '243', collects: '296', comments: '' });
    });

    it('preserves an explicit legacy zero like count', () => {
        expect(extract('<span class="like-count">0</span>'))
            .toMatchObject({ likes: '0', collects: '', comments: '' });
    });

    it('keeps an unknown SVG symbol unknown', () => {
        expect(extract('<span><svg><use href="#offline-unrecognized-metric"></use></svg><span class="count">296</span></span>'))
            .toMatchObject({ likes: '', collects: '', comments: '' });
    });

    it('preserves the shared extractor host contract for rednote', () => {
        const result = extract('', 'www.rednote.com');
        expect(result).toMatchObject({ likes: '', collects: '', comments: '', url: `https://www.rednote.com/explore/${noteId}` });
    });
});

describe('normalizeSearchCount', () => {
    it.each([
        [0, '0'],
        [243, '243'],
        ['0', '0'],
        [' 296 ', '296'],
        ['1.2万', '1.2万'],
    ])('normalizes a known count %j to string %j', (input, expected) => {
        expect(__test__.normalizeSearchCount(input)).toBe(expected);
    });

    it.each([undefined, null, '', '   ', '未取得', '—', 'unknown', -1, '-1', NaN, Infinity, true, false, {}, []])(
        'keeps unavailable or invalid count %j unknown', (input) => {
            expect(__test__.normalizeSearchCount(input)).toBe('');
        },
    );
});

function apiNote(id, interact = {}, extra = {}) {
    return { id, model_type: 'note', note_card: { interact_info: interact }, ...extra };
}

function capture(items = [], extra = {}) {
    return { success: true, code: 0, data: { items }, ...extra };
}

describe('applySearchMetrics', () => {
    it('joins by note ID when API item order differs and contains unrelated items', () => {
        const rows = [row(), row({ url: otherUrl, title: '第二条' })];
        const captures = [capture([
            apiNote(otherId, { liked_count: '324', collected_count: '344', comment_count: '11' }),
            apiNote('68e90be80000000004022e68', { liked_count: '999' }),
            apiNote(noteId, { liked_count: '243', collected_count: '296', comment_count: '9' }),
        ])];
        expect(__test__.applySearchMetrics(rows, captures)).toMatchObject([
            { url, title: '离线样本', likes: '243', collects: '296', comments: '9' },
            { url: otherUrl, title: '第二条', likes: '324', collects: '344', comments: '11' },
        ]);
    });

    it('keeps missing counts unknown and preserves numeric and string zero independently', () => {
        expect(__test__.applySearchMetrics([row()], [capture([
            apiNote(noteId, { liked_count: 0, collected_count: '0' }),
        ])])).toMatchObject([{ likes: '0', collects: '0', comments: '' }]);
    });

    it('lets valid named API counts take priority over DOM values', () => {
        expect(__test__.applySearchMetrics([row({ likes: '8', collects: '7', comments: '6' })], [capture([
            apiNote(noteId, { liked_count: '243', collected_count: '296', comment_count: 0 }),
        ])])).toMatchObject([{ likes: '243', collects: '296', comments: '0' }]);
    });

    it('retains known DOM counts when the matching API count is missing or invalid', () => {
        expect(__test__.applySearchMetrics([row({ likes: '243', collects: '296', comments: '9' })], [capture([
            apiNote(noteId, { liked_count: null, collected_count: '', comment_count: 'unknown' }),
        ])])).toMatchObject([{ likes: '243', collects: '296', comments: '9' }]);
    });

    it.each([
        { success: false, code: 0 },
        { success: true, code: -1 },
        { success: undefined, code: 0 },
        { success: true, code: undefined },
    ])('ignores responses without both success:true and code:0: %j', (status) => {
        expect(__test__.applySearchMetrics([row()], [capture([
            apiNote(noteId, { liked_count: '999', collected_count: '999', comment_count: '999' }),
        ], status)])).toMatchObject([{ likes: '', collects: '', comments: '' }]);
    });

    it('ignores non-note model items even when their ID and card look usable', () => {
        expect(__test__.applySearchMetrics([row()], [capture([
            apiNote(noteId, { liked_count: '999' }, { model_type: 'query' }),
        ])])).toMatchObject([{ likes: '', collects: '', comments: '' }]);
    });

    it('does not match an unrelated ID by array position', () => {
        expect(__test__.applySearchMetrics([row()], [capture([
            apiNote(otherId, { liked_count: '324', collected_count: '344', comment_count: '11' }),
        ])])).toMatchObject([{ url, likes: '', collects: '', comments: '' }]);
    });

    it('keeps harvested rows usable when captures are empty or malformed', () => {
        expect(__test__.applySearchMetrics([row({ collects: '296' })], [
            null,
            {},
            capture([], { data: null }),
            capture([], { data: { items: 'not-an-array' } }),
            capture([null, apiNote(noteId)]),
        ])).toMatchObject([{ likes: '', collects: '296', comments: '' }]);
        expect(__test__.applySearchMetrics([row()], [])).toMatchObject([{ likes: '', collects: '', comments: '' }]);
    });
});

function metricPage(rows, staleCaptures, liveCaptures) {
    const events = [];
    let reads = 0;
    const page = {
        goto: vi.fn(async () => { events.push('goto'); }),
        installInterceptor: vi.fn(async () => { events.push('install'); }),
        getInterceptedRequests: vi.fn(async () => {
            events.push(reads === 0 ? 'drain' : 'read');
            return reads++ === 0 ? staleCaptures : liveCaptures;
        }),
        evaluate: vi.fn(async (script) => {
            const source = String(script);
            if (source.includes('const query =')) {
                events.push('search');
                return { status: 'ok' };
            }
            if (source.includes('const requestedFilters =')) return { status: 'ok' };
            if (source.includes('const targetCount =')) {
                events.push('harvest');
                return {
                    rows,
                    diag: {
                        securityBlock: false, stopReason: 'target', scrollHeight: 2000,
                        clientHeight: 800, cardCount: rows.length,
                        feedClientHeight: 1600, distinctCardTops: rows.length,
                    },
                };
            }
            return 'content';
        }),
    };
    return { page, events };
}

describe('command.func natural search capture integration', () => {
    it('drains before search and maps post-harvest API counts by ID without changing DOM order', async () => {
        const stale = capture([apiNote(noteId, { liked_count: '9999', collected_count: '9999', comment_count: '9999' })]);
        const live = capture([
            apiNote(otherId, { liked_count: '324', collected_count: '344', comment_count: '11' }),
            apiNote(noteId, { liked_count: '243', collected_count: '296', comment_count: '9' }),
        ]);
        const { page, events } = metricPage([row(), row({ url: otherUrl, title: '第二条' })], [stale], [live]);
        const result = await command.func(page, { query: '离线指标测试', limit: 2 });
        expect(result).toMatchObject([
            { rank: 1, url, title: '离线样本', likes: '243', collects: '296', comments: '9' },
            { rank: 2, url: otherUrl, title: '第二条', likes: '324', collects: '344', comments: '11' },
        ]);
        expect(result).toHaveLength(2);
        expect(page.goto).toHaveBeenCalledExactlyOnceWith('https://www.xiaohongshu.com/explore');
        expect(page.installInterceptor).toHaveBeenCalledExactlyOnceWith('/api/sns/web/v2/search/notes');
        expect(events).toEqual(['goto', 'install', 'drain', 'search', 'harvest', 'read']);
    });

    it('does not reuse a drained stale capture when the new query captures no metrics', async () => {
        const stale = capture([apiNote(noteId, { liked_count: '9999', collected_count: '9999', comment_count: '9999' })]);
        const { page } = metricPage([row({ collects: '0' })], [stale], []);
        expect(await command.func(page, { query: '离线无捕获测试', limit: 1 }))
            .toMatchObject([{ likes: '', collects: '0', comments: '' }]);
        expect(page.getInterceptedRequests).toHaveBeenCalledTimes(2);
    });
});

describe('search metric merge contract', () => {
    it.each(['likes', 'collects', 'comments'])('backfills unknown %s with an explicit zero', (field) => {
        const acc = new Map();
        mergeHarvestedRow(acc, row(), webHost);
        expect(mergeHarvestedRow(acc, row({ [field]: '0' }), webHost)).toBe(true);
        expect(acc.get(noteId)[field]).toBe('0');
    });

    it.each(['likes', 'collects', 'comments'])('preserves known zero %s rather than treating it as missing', (field) => {
        const acc = new Map();
        mergeHarvestedRow(acc, row({ [field]: '0' }), webHost);
        expect(mergeHarvestedRow(acc, row({ [field]: '42' }), webHost)).toBe(false);
        expect(acc.get(noteId)[field]).toBe('0');
    });

    it('merges named source counts independently without moving a collection into likes', () => {
        const acc = new Map();
        mergeHarvestedRow(acc, row({ collects: '296' }), webHost);
        expect(mergeHarvestedRow(acc, row({ likes: '243', comments: '9' }), webHost)).toBe(true);
        expect(acc.get(noteId)).toMatchObject({ likes: '243', collects: '296', comments: '9' });
    });

    it('preserves known counts when a later virtualized frame lacks metrics', () => {
        const acc = new Map();
        mergeHarvestedRow(acc, row({ likes: '243', collects: '296', comments: '9' }), webHost);
        expect(mergeHarvestedRow(acc, row(), webHost)).toBe(false);
        expect(acc.get(noteId)).toMatchObject({ likes: '243', collects: '296', comments: '9' });
    });
});
