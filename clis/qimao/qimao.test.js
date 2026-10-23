import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import './search.js';
import './catalog.js';
import './book.js';
import './read.js';
import './browse.js';
import './browse-options.js';
import './rank.js';
import './rank-options.js';
import { __test__ as bookTest } from './book.js';
import { __test__ as readTest } from './read.js';
import { __test__ as browseTest } from './browse.js';
import { __test__ as rankTest } from './rank.js';
import { parseBookId, parseChapterId, stripHtml } from './utils.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('qimao utils', () => {
    it('parses qimao book and chapter identifiers from ids and urls', () => {
        expect(parseBookId('1784909')).toBe('1784909');
        expect(parseBookId('https://www.qimao.com/shuku/1784909/')).toBe('1784909');
        expect(parseBookId('https://www.qimao.com/shuku/1784909-17059219630001/')).toBe('1784909');
        expect(parseBookId('https://www.qimao.com/reader/index/1784909/')).toBe('1784909');
        expect(parseChapterId('17059219630001')).toBe('17059219630001');
        expect(parseChapterId('https://www.qimao.com/shuku/1784909-17059219630001/')).toBe('17059219630001');
    });

    it('decodes html fragments into plain text', () => {
        expect(stripHtml('<p>Hello&nbsp;<b>World</b></p><p>&#x4F60;&#22909;</p>')).toBe('Hello World\n你好');
    });
});

describe('qimao search command', () => {
    const cmd = getRegistry().get('qimao/search');

    it('rejects invalid query/limit/page before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const page = { evaluate: vi.fn() };
        await expect(cmd.func(page, { query: '   ', limit: 10, page: 1 })).rejects.toThrow(ArgumentError);
        await expect(cmd.func(page, { query: '凡人修仙传', limit: 0, page: 1 })).rejects.toThrow(ArgumentError);
        await expect(cmd.func(page, { query: '凡人修仙传', limit: 10, page: 0 })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns normalized search rows from the public api', async () => {
        const payload = {
            data: {
                search_list: [{
                    book_id: '1784909',
                    title: '凡人修仙传（杨洋、金晨主演同名影视原著）',
                    author: '忘语',
                    category2_name: '古典仙侠',
                    is_over_txt: '完结',
                    words_num: '747.84万字',
                    characters: '韩立',
                    latest_chapter_title: '忘语新书《玄界之门》',
                    update_time: '2024-01-24 09:51:50',
                    read_url: 'https://www.qimao.com/shuku/1784909/',
                    intro: '<p>一个普通山村小子。</p>',
                }],
            },
        };
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
        const page = {
            evaluate: vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                text: JSON.stringify(payload),
            }),
        };
        const rows = await cmd.func(page, { query: '凡人修仙传', limit: 5, page: 1 });
        expect(rows).toHaveLength(1);
        expect(page.evaluate).toHaveBeenCalledTimes(1);
        expect(rows[0]).toMatchObject({
            rank: 1,
            book_id: '1784909',
            author: '忘语',
            category: '古典仙侠',
            status: '完结',
            words: '747.84万字',
            latest_chapter: '忘语新书《玄界之门》',
        });
        expect(rows[0].intro).toBe('一个普通山村小子。');
    });
});

describe('qimao catalog command', () => {
    const cmd = getRegistry().get('qimao/catalog');

    it('returns normalized chapter rows with limit/offset slicing', async () => {
        const payload = {
            data: {
                chapters: [
                    { id: '17059219630001', title: '第一章 山边小村', words: '2601', is_vip: '0', update_time: '1203482820', index: '1' },
                    { id: '17059219630002', title: '第二章 青牛镇', words: '2134', is_vip: '0', update_time: '1203482880', index: '2' },
                ],
            },
        };
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 })));
        const rows = await cmd.func({ evaluate: vi.fn() }, { book: '1784909', limit: 1, offset: 1 });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            index: 2,
            chapter_id: '17059219630002',
            title: '第二章 青牛镇',
            words: 2134,
            is_vip: false,
            url: 'https://www.qimao.com/shuku/1784909-17059219630002/',
        });
    });
});

describe('qimao book command', () => {
    const cmd = getRegistry().get('qimao/book');

    it('normalizes book snapshot fields', () => {
        const row = bookTest.normalizeBookSnapshot({
            title: '凡人修仙传（杨洋、金晨主演同名影视原著）',
            author: '忘语',
            category: '古典仙侠',
            status: 1,
            score: '9.4',
            words: '747.84万字',
            chapters: '2551',
            characters: '韩立',
            latest_chapter: '忘语新书《玄界之门》',
            updated_at: '2024-01-24 09:51:50',
            intro: '一个普通山村小子。',
            cover: 'https://cdn.example.com/cover.jpg',
            url: 'https://www.qimao.com/shuku/1784909/',
        }, '1784909');
        expect(row).toMatchObject({
            book_id: '1784909',
            title: '凡人修仙传（杨洋、金晨主演同名影视原著）',
            status: '完结',
            chapters: 2551,
        });
    });

    it('uses browser extraction on the public book page', async () => {
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({
                title: '凡人修仙传（杨洋、金晨主演同名影视原著）',
                author: '忘语',
                category: '古典仙侠',
                status: 1,
                score: '9.4',
                words: '747.84万字',
                chapters: '2551',
                characters: '韩立',
                latest_chapter: '忘语新书《玄界之门》',
                updated_at: '2024-01-24 09:51:50',
                intro: '一个普通山村小子。',
                cover: 'https://cdn.example.com/cover.jpg',
                url: 'https://www.qimao.com/shuku/1784909/',
            }),
        };
        const rows = await cmd.func(page, { book: '1784909' });
        expect(page.goto).toHaveBeenCalledWith('https://www.qimao.com/shuku/1784909/', { waitUntil: 'load', settleMs: 2000 });
        expect(rows[0]).toMatchObject({
            book_id: '1784909',
            author: '忘语',
            category: '古典仙侠',
        });
    });
});

describe('qimao read command', () => {
    const cmd = getRegistry().get('qimao/read');

    it('normalizes chapter content rows', () => {
        const row = readTest.normalizeReadSnapshot({
            book_id: '1784909',
            book_title: '凡人修仙传（杨洋、金晨主演同名影视原著）',
            author: '忘语',
            chapter_id: '17059219630002',
            chapter_title: '第二章 青牛镇',
            words: '2134',
            updated_at: '2008-02-20 12:48:00',
            url: 'https://www.qimao.com/shuku/1784909-17059219630002/',
            content: '这是一个小城。',
        }, {
            chapter_id: '17059219630002',
            index: 2,
            title: '第二章 青牛镇',
            words: 2134,
            updated_at: '2008-02-20 12:48:00',
            url: 'https://www.qimao.com/shuku/1784909-17059219630002/',
        });
        expect(row).toMatchObject({
            book_id: '1784909',
            index: 2,
            chapter_title: '第二章 青牛镇',
            content: '这是一个小城。',
        });
    });

    it('removes empty lines from chapter content', () => {
        const row = readTest.normalizeReadSnapshot({
            book_id: '1784909',
            chapter_title: '第二章 青牛镇',
            content: '第一段\n\n\n第二段\n   \n第三段',
        }, {
            chapter_id: '17059219630002',
            index: 2,
            title: '第二章 青牛镇',
            words: 2134,
            updated_at: '2008-02-20 12:48:00',
            url: 'https://www.qimao.com/shuku/1784909-17059219630002/',
        });
        expect(row.content).toBe('第一段\n第二段\n第三段');
    });

    it('reads a target chapter resolved from the catalog api', async () => {
        const payload = {
            data: {
                chapters: [
                    { id: '17059219630001', title: '第一章 山边小村', words: '2601', is_vip: '0', update_time: '1203482820', index: '1' },
                    { id: '17059219630002', title: '第二章 青牛镇', words: '2134', is_vip: '0', update_time: '1203482880', index: '2' },
                ],
            },
        };
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn()
                .mockResolvedValueOnce({
                    ok: true,
                    status: 200,
                    text: JSON.stringify(payload),
                })
                .mockResolvedValueOnce({
                    book_id: '1784909',
                    book_title: '凡人修仙传（杨洋、金晨主演同名影视原著）',
                    author: '忘语',
                    chapter_id: '17059219630002',
                    chapter_title: '第二章 青牛镇',
                    words: '2134',
                    updated_at: '2008-02-20 12:48:00',
                    url: 'https://www.qimao.com/shuku/1784909-17059219630002/',
                    content: '这是一个小城。',
                }),
        };
        const rows = await cmd.func(page, { book: '1784909', 'chapter-index': 2 });
        expect(page.goto).toHaveBeenCalledWith('https://www.qimao.com/shuku/1784909-17059219630002/', { waitUntil: 'load', settleMs: 2000 });
        expect(page.evaluate).toHaveBeenCalledTimes(2);
        expect(rows[0]).toMatchObject({
            chapter_id: '17059219630002',
            chapter_title: '第二章 青牛镇',
            content: '这是一个小城。',
        });
    });

    it('throws when the requested chapter is missing', async () => {
        const payload = {
            data: {
                chapters: [
                    { id: '17059219630001', title: '第一章 山边小村', words: '2601', is_vip: '0', update_time: '1203482820', index: '1' },
                ],
            },
        };
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 })));
        const page = {
            goto: vi.fn(),
            wait: vi.fn(),
            evaluate: vi.fn(),
        };
        await expect(cmd.func(page, { book: '1784909', 'chapter-index': 2 })).rejects.toThrow(EmptyResultError);
    });
});

describe('qimao browse command', () => {
    const cmd = getRegistry().get('qimao/browse');

    it('resolves category ids from top-level and child categories', () => {
        const categories = [
            { id: '1', name: '现代言情', children: [{ id: '8', name: '总裁豪门' }] },
            { id: '203', name: '都市', children: [{ id: '219', name: '都市高武' }] },
        ];
        expect(browseTest.resolveCategoryValue('现代言情', categories)).toMatchObject({ category1: '1', category2: 'a' });
        expect(browseTest.resolveCategoryValue('总裁豪门', categories)).toMatchObject({ category1: '1', category2: '8' });
        expect(browseTest.resolveCategoryValue('219', categories)).toMatchObject({ category1: '203', category2: '219' });
    });

    it('normalizes listing rows', () => {
        expect(browseTest.normalizeBrowseRow({
            book_id: '2062428',
            title: '雾色京婚',
            author: '栗子甜豆糕',
            category2_name: '总裁豪门',
            is_over_txt: '连载中',
            words_num: '102.84万字',
            latest_chapter_title: '第480章  另一个乔梨？',
            update_time_txt: '2026-05-09 08:22:06',
            read_url: 'https://www.qimao.com/shuku/2062428/',
            intro: '第一段\n\n第二段',
        }, 6)).toMatchObject({
            rank: 6,
            book_id: '2062428',
            title: '雾色京婚',
            category: '总裁豪门',
            intro: '第一段\n第二段',
        });
    });

    it('normalizes browse option rows', () => {
        const rows = browseTest.normalizeBrowseOptionRows({
            filters: {
                channel: [{ label: '女生原创', value: '1' }],
                words: [{ label: '100万-200万', value: '4' }],
                update_time: [{ label: '7天内', value: '2' }],
                is_over: [{ label: '连载中', value: '0' }],
                order: [{ label: '最近更新', value: 'update_time' }],
            },
            category: [
                { id: '1', name: '现代言情', children: [{ id: '8', name: '总裁豪门' }] },
            ],
        });
        expect(rows).toEqual(expect.arrayContaining([
            { group: 'channel', label: '女生原创', value: '1', parent_label: '', parent_value: '' },
            { group: 'category1', label: '现代言情', value: '1', parent_label: '', parent_value: '' },
            { group: 'category2', label: '总裁豪门', value: '8', parent_label: '现代言情', parent_value: '1' },
        ]));
    });

    it('returns filtered category rows from classify APIs', async () => {
        const payloads = [
            {
                data: {
                    category: [
                        { id: '1', name: '现代言情', children: [{ id: '8', name: '总裁豪门' }] },
                        { id: '203', name: '都市', children: [{ id: '219', name: '都市高武' }] },
                    ],
                },
            },
            {
                data: {
                    book_list: [
                        {
                            book_id: '2062428',
                            title: '雾色京婚',
                            author: '栗子甜豆糕',
                            category2_name: '总裁豪门',
                            is_over_txt: '连载中',
                            words_num: '102.84万字',
                            latest_chapter_title: '第480章  另一个乔梨？',
                            update_time_txt: '2026-05-09 08:22:06',
                            read_url: 'https://www.qimao.com/shuku/2062428/',
                            intro: '第一段\r\n\r\n第二段',
                        },
                    ],
                },
            },
        ];
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify(payloads[0]), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify(payloads[1]), { status: 200 })));
        const rows = await cmd.func({ evaluate: vi.fn() }, {
            category: '总裁豪门',
            channel: '女生原创',
            words: '100万-200万',
            'updated-within': '7天内',
            status: '连载中',
            sort: '最近更新',
            page: 1,
            limit: 5,
        });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            rank: 1,
            book_id: '2062428',
            title: '雾色京婚',
            category: '总裁豪门',
            intro: '第一段\n第二段',
        });
    });
});

describe('qimao browse-options command', () => {
    const cmd = getRegistry().get('qimao/browse-options');

    it('returns normalized filter metadata rows', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            data: {
                filters: {
                    channel: [{ label: '女生原创', value: '1' }],
                    words: [{ label: '100万-200万', value: '4' }],
                    update_time: [{ label: '7天内', value: '2' }],
                    is_over: [{ label: '连载中', value: '0' }],
                    order: [{ label: '最近更新', value: 'update_time' }],
                },
                category: [
                    { id: '1', name: '现代言情', children: [{ id: '8', name: '总裁豪门' }] },
                ],
            },
        }), { status: 200 })));
        const rows = await cmd.func({ evaluate: vi.fn() }, { group: 'category2' });
        expect(rows).toEqual([
            { group: 'category2', label: '总裁豪门', value: '8', parent_label: '现代言情', parent_value: '1' },
        ]);
    });
});

describe('qimao rank command', () => {
    const cmd = getRegistry().get('qimao/rank');

    it('normalizes ranking rows', () => {
        expect(rankTest.normalizeRankRow({
            book_id: '1761978',
            title: '葬神棺',
            author: '浮生一诺',
            category1_name: '玄幻奇幻',
            category2_name: '东方玄幻',
            is_over: 0,
            words_num: '665.48万字',
            latest_chapter_title: '第2549章 神墟第一魄，尸狗！',
            update_time: '2026-05-07 23:32:22',
            number: '64.0',
            unit: '万热度',
            book_url: 'https://www.qimao.com/shuku/1761978/',
            intro: '第一段\r\n\r\n第二段',
        }, 5)).toMatchObject({
            rank: 5,
            book_id: '1761978',
            category1: '玄幻奇幻',
            category: '东方玄幻',
            status: '连载中',
            intro: '第一段\n第二段',
        });
    });

    it('returns ranking rows from page snapshot data', async () => {
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({
                listData: [{
                    book_id: '1761978',
                    title: '葬神棺',
                    author: '浮生一诺',
                    category1_name: '玄幻奇幻',
                    category2_name: '东方玄幻',
                    is_over: 0,
                    words_num: '665.48万字',
                    latest_chapter_title: '第2549章 神墟第一魄，尸狗！',
                    update_time: '2026-05-07 23:32:22',
                    number: '64.0',
                    unit: '万热度',
                    book_url: 'https://www.qimao.com/shuku/1761978/',
                    intro: '第一段\n第二段',
                }],
            }),
        };
        const rows = await cmd.func(page, { channel: '男生', type: '大热榜', period: '日榜', limit: 5 });
        expect(page.goto).toHaveBeenCalledWith('https://www.qimao.com/paihang/boy/hot/date/', { waitUntil: 'load', settleMs: 2000 });
        expect(rows[0]).toMatchObject({
            rank: 1,
            book_id: '1761978',
            title: '葬神棺',
        });
    });
});

describe('qimao rank-options command', () => {
    const cmd = getRegistry().get('qimao/rank-options');

    it('returns ranking dimension rows', async () => {
        const rows = await cmd.func({}, { group: 'type' });
        expect(rows).toEqual(expect.arrayContaining([
            { group: 'type', label: '大热榜', value: 'hot' },
            { group: 'type', label: '新书榜', value: 'new' },
            { group: 'type', label: '完结榜', value: 'over' },
        ]));
    });
});
