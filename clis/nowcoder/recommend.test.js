import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './recommend.js';

const recommend = getRegistry().get('nowcoder/recommend');
const CAPTURE = JSON.parse(readFileSync(
    new URL('./__fixtures__/recommend.capture.json', import.meta.url),
    'utf8',
));

function envelope(records) {
    return { success: true, code: 0, msg: 'OK', data: { records } };
}

function record({ type = 74, entityId, id, title = '', content = '', cursorScore, nickname = 'Author' }) {
    const base = {
        contentType: type,
        contentId: id,
        extraInfo: { entityId: String(entityId) },
        userBrief: { nickname },
        frequencyData: { likeCnt: 1, commentCnt: 2, viewCnt: 3 },
        recommendData: { cursorScore },
    };
    if (type === 250) {
        return {
            ...base,
            contentData: { id, uuid: id, title, content },
        };
    }
    if (type === 74) {
        return {
            ...base,
            momentData: { id, uuid: id, title, content },
        };
    }
    return {
        ...base,
        recommendCreativity: {
            adId: id,
            title,
            content,
            companyName: `${nickname} company`,
            linkUrl: `https://example.com/${id}`,
        },
    };
}

function pageWith(payloads) {
    const fetchJson = vi.fn();
    for (const payload of payloads) fetchJson.mockResolvedValueOnce(payload);
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue('visit-user-1'),
        fetchJson,
    };
}

function manyRecords(prefix, count, cursorStart) {
    return Array.from({ length: count }, (_, index) => record({
        entityId: `${prefix}-${index + 1}`,
        id: `${prefix}-${index + 1}`,
        title: `${prefix} ${index + 1}`,
        content: `${prefix} body ${index + 1}`,
        cursorScore: cursorStart - index,
    }));
}

describe('nowcoder recommend cursor pagination', () => {
    it('replays prior pages with cuid and cursorScore, then continues only while page 2 output is short', async () => {
        const page = pageWith([
            envelope([
                record({ entityId: 'e1', id: 'content-1', type: 250, title: 'First', cursorScore: 100 }),
                record({ entityId: 'e2', id: 'moment-1', type: 74, content: 'Body', cursorScore: 99 }),
                record({ entityId: 'e3', id: 'ad-1', type: 993, title: 'Promoted', content: 'Ad body', cursorScore: 98 }),
            ]),
            envelope([
                record({ entityId: 'e3', id: 'moment-duplicate', type: 74, cursorScore: 98 }),
                record({ entityId: 'e4', id: 'moment-2', type: 74, content: 'No title', cursorScore: 90 }),
                record({ entityId: 'e5', id: 'ad-2', type: 993, title: 'Second ad', content: 'Ad', cursorScore: 89 }),
            ]),
            envelope([]),
        ]);

        const rows = await recommend.func(page, { page: 2, limit: 5 });

        expect(page.goto).toHaveBeenCalledWith('https://www.nowcoder.com');
        expect(page.fetchJson).toHaveBeenCalledTimes(3);
        expect(page.fetchJson.mock.calls[0][0]).toContain('page=1');
        expect(page.fetchJson.mock.calls[0][0]).toContain('size=20');
        expect(page.fetchJson.mock.calls[0][0]).toContain('cuid=visit-user-1');
        expect(page.fetchJson.mock.calls[0][0]).not.toContain('cursorScore=');
        expect(page.fetchJson.mock.calls[0][1].timeoutMs).toBeLessThanOrEqual(15000);
        expect(page.fetchJson.mock.calls[1][0]).toContain('page=2');
        expect(page.fetchJson.mock.calls[1][0]).toContain('cursorScore=98');
        expect(page.fetchJson.mock.calls[2][0]).toContain('page=3');
        expect(page.fetchJson.mock.calls[2][0]).toContain('cursorScore=89');
        expect(rows).toMatchObject([
            { rank: 1, post_type: 'moment', id: 'moment-2', title: '(untitled)', content: 'No title' },
            {
                rank: 2,
                post_type: 'promotion',
                id: 'ad-2',
                title: 'Second ad',
                content: 'Ad',
                company: 'Author company',
                url: 'https://example.com/ad-2',
            },
        ]);
    });

    it('keeps titleless content and promotion cards on page 1 with contiguous ranks', async () => {
        const page = pageWith([
            envelope([
                record({ entityId: 'e1', id: 'moment-1', type: 74, title: '', content: 'Body', cursorScore: 20 }),
                record({ entityId: 'e2', id: 'ad-1', type: 993, title: 'Promotion title', content: 'Promotion body', cursorScore: 19 }),
            ]),
        ]);

        const rows = await recommend.func(page, { page: 1, limit: 2 });

        expect(page.fetchJson).toHaveBeenCalledTimes(1);
        expect(recommend.columns).toEqual(expect.arrayContaining(['company', 'content', 'url']));
        expect(rows.map(({ rank, post_type, id, title }) => ({ rank, post_type, id, title }))).toEqual([
            { rank: 1, post_type: 'moment', id: 'moment-1', title: '(untitled)' },
            { rank: 2, post_type: 'promotion', id: 'ad-1', title: 'Promotion title' },
        ]);
    });

    it('continues from the starting page until --limit is reached with fixed upstream size 20', async () => {
        const firstPage = manyRecords('first', 20, 1000);
        const secondPage = manyRecords('second', 20, 900);
        const page = pageWith([
            envelope(firstPage),
            envelope(secondPage),
        ]);

        const rows = await recommend.func(page, { page: 1, limit: 30 });

        expect(page.fetchJson).toHaveBeenCalledTimes(2);
        expect(page.fetchJson.mock.calls[0][0]).toContain('page=1');
        expect(page.fetchJson.mock.calls[0][0]).toContain('size=20');
        expect(page.fetchJson.mock.calls[1][0]).toContain('page=2');
        expect(page.fetchJson.mock.calls[1][0]).toContain('cursorScore=981');
        expect(rows).toHaveLength(30);
        expect(rows.map(row => row.id)).toEqual([
            ...firstPage.map((_, index) => `first-${index + 1}`),
            ...secondPage.slice(0, 10).map((_, index) => `second-${index + 1}`),
        ]);
        expect(rows.map(row => row.rank)).toEqual(Array.from({ length: 30 }, (_, index) => index + 1));
    });

    it('advances through a duplicate page-tail cursor instead of stopping on dedupe', async () => {
        const firstPage = manyRecords('first', 20, 1000);
        const secondPage = [
            ...manyRecords('second', 19, 919),
            {
                ...firstPage[19],
                recommendData: { ...firstPage[19].recommendData, cursorScore: 900 },
            },
        ];
        const thirdPage = manyRecords('third', 1, 899);
        const page = pageWith([
            envelope(firstPage),
            envelope(secondPage),
            envelope(thirdPage),
        ]);

        const rows = await recommend.func(page, { page: 1, limit: 40 });

        expect(page.fetchJson).toHaveBeenCalledTimes(3);
        expect(page.fetchJson.mock.calls[2][0]).toContain('page=3');
        expect(page.fetchJson.mock.calls[2][0]).toContain('cursorScore=900');
        expect(rows).toHaveLength(40);
        expect(rows[39].id).toBe('third-1');
    });

    it('returns the available rows when the upstream cursor reaches an empty page', async () => {
        const page = pageWith([
            envelope(manyRecords('first', 20, 1000)),
            envelope([]),
        ]);

        const rows = await recommend.func(page, { page: 1, limit: 50 });

        expect(page.fetchJson).toHaveBeenCalledTimes(2);
        expect(rows).toHaveLength(20);
        expect(rows.at(-1).rank).toBe(20);
    });

    it('parses cropped mixed records from the 2026-11-22 live capture', async () => {
        const page = pageWith([
            envelope(CAPTURE.pages[0].records),
        ]);

        const rows = await recommend.func(page, { page: 1, limit: 3 });

        expect(page.fetchJson).toHaveBeenCalledTimes(1);
        expect(page.fetchJson.mock.calls[0][0]).toContain('size=20');
        expect(rows.map(({ post_type, title }) => ({ post_type, title }))).toEqual([
            { post_type: 'moment', title: 'Captured moment' },
            { post_type: 'promotion', title: 'Captured promotion' },
            { post_type: 'content', title: 'Captured content' },
        ]);
    });

    it('prefers distinct numeric content and long-content IDs for detail round trips', async () => {
        const page = pageWith([
            envelope([
                {
                    contentType: 250,
                    contentId: 1009,
                    extraInfo: { entityId: '1009' },
                    recommendData: { cursorScore: 20 },
                    contentData: {
                        id: 912885704667,
                        uuid: '00000000000000000000000000000001',
                        title: 'Numeric content',
                        content: 'Content body',
                    },
                    userBrief: { nickname: 'Content author' },
                    frequencyData: { likeCnt: 1, commentCnt: 2, viewCnt: 3 },
                },
                {
                    contentType: 250,
                    contentId: 1010,
                    extraInfo: { entityId: '1010' },
                    recommendData: { cursorScore: 19 },
                    longContentData: {
                        id: '912885704668',
                        uuid: '00000000000000000000000000000002',
                        title: 'Numeric long content',
                        content: 'Long content body',
                    },
                    userBrief: { nickname: 'Long content author' },
                    frequencyData: { likeCnt: 1, commentCnt: 2, viewCnt: 3 },
                },
            ]),
        ]);

        const rows = await recommend.func(page, { page: 1, limit: 2 });

        expect(rows.map(row => row.id)).toEqual(['912885704667', '912885704668']);
        expect(rows.map(row => row.url)).toEqual([
            'https://www.nowcoder.com/discuss/912885704667',
            'https://www.nowcoder.com/discuss/912885704668',
        ]);
        expect(rows[0].id).not.toBe('00000000000000000000000000000001');
        expect(rows[1].id).not.toBe('00000000000000000000000000000002');
    });

    it('uses an outer numeric content ID before a UUID and leaves unknown IDs empty', async () => {
        const page = pageWith([envelope([
            {
                contentType: 250, contentId: '123456789012',
                extraInfo: { entityId: 'first' }, recommendData: { cursorScore: 2 },
                contentData: { uuid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', title: 'Outer ID' },
            },
            {
                contentType: 250,
                extraInfo: { entityId: 'second' }, recommendData: { cursorScore: 1 },
                contentData: { uuid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', title: 'Unknown ID' },
            },
        ])]);
        const rows = await recommend.func(page, { page: 1, limit: 2 });
        expect(rows.map(({ id, url }) => ({ id, url }))).toEqual([
            { id: '123456789012', url: 'https://www.nowcoder.com/discuss/123456789012' },
            { id: '', url: '' },
        ]);
    });

    it('validates page and limit before browser work', () => {
        expect(() => recommend.validateArgs({ page: 0, limit: 15 })).toThrow(ArgumentError);
        expect(() => recommend.validateArgs({ page: 1, limit: 0 })).toThrow(ArgumentError);
    });

    it('fails explicitly when the requested page yields no supported records', async () => {
        const page = pageWith([envelope([])]);

        await expect(recommend.func(page, { page: 1, limit: 15 }))
            .rejects.toBeInstanceOf(EmptyResultError);
    });
});
