import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { __test__ } from './comments.js';

const registry = getRegistry();
const command = registry.get('nowcoder/comments');

function response(payload, { ok = true, status = 200 } = {}) {
    return {
        ok,
        status,
        json: vi.fn().mockResolvedValue(payload),
    };
}

function comment(id, overrides = {}) {
    return {
        id,
        authorId: 9001,
        userBrief: { userId: 9001, nickname: 'Alice' },
        pureText: 'hello',
        createTime: 1700000000000,
        frequencyData: { likeCnt: 3, commentCnt: 2, totalCommentCnt: 2 },
        ip4: '203.0.113.42',
        ip4Location: '上海',
        ...overrides,
    };
}

function commentPage(records, overrides = {}) {
    return response({
        success: true,
        code: 0,
        data: {
            current: 1,
            size: 20,
            totalPage: 1,
            records,
            ...overrides,
        },
    });
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('nowcoder comments', () => {
    it('registers comments as a public read command', () => {
        expect(command).toBeDefined();
        expect(command.access).toBe('read');
        expect(command.strategy).toBe('public');
        expect(command.browser).toBe(false);
        expect(registry.get('nowcoder/get_comments')).toBeUndefined();
        expect(command.args.find(arg => arg.name === 'parent')).toBeUndefined();
        expect(command.args
            .filter(arg => !arg.positional && arg.type !== 'boolean')
            .every(arg => arg.valueRequired)).toBe(true);
    });

    it('returns structured top-level comments without exposing raw IP addresses', async () => {
        const fetch = vi.fn().mockResolvedValue(commentPage([comment(101)]));
        vi.stubGlobal('fetch', fetch);

        const rows = await command.func({
            id: 'https://www.nowcoder.com/discuss/1656390?sourceSSR=search',
            limit: 20,
            page: 1,
            order: 'new',
        });

        expect(fetch).toHaveBeenCalledTimes(1);
        const url = new URL(fetch.mock.calls[0][0]);
        expect(url.pathname).toBe('/api/sparta/comment/list-by-page');
        expect(Object.fromEntries(url.searchParams)).toEqual({
            entityId: '1656390',
            entityType: '250',
            order: '0',
            pageNo: '1',
            toCommentId: '0',
        });
        expect(rows).toEqual([{
            rank: 1,
            id: '101',
            root_id: '101',
            parent_id: '',
            depth: 0,
            ancestry_complete: true,
            author_id: '9001',
            author: 'Alice',
            reply_to_author_id: '',
            reply_to_author: '',
            content: 'hello',
            likes: 3,
            replies: 2,
            direct_replies: null,
            time: '2023-11-14T22:13:20.000Z',
            location: '上海',
        }]);
        expect(rows[0]).not.toHaveProperty('ip4');
    });

    it('resolves a moment UUID to entity type 74', async () => {
        const fetch = vi.fn()
            .mockResolvedValueOnce(response({
                success: true,
                code: 0,
                data: { id: 2878676, entityId: 2878676, entityType: 74 },
            }))
            .mockResolvedValueOnce(commentPage([comment(102, { frequencyData: {} })]));
        vi.stubGlobal('fetch', fetch);

        await command.func({ id: '3e22dc2df03d4227ab70ea9c2d896086', limit: 1 });

        expect(fetch.mock.calls[0][0]).toContain('/api/sparta/detail/moment-data/detail/3e22dc2df03d4227ab70ea9c2d896086');
        const commentsUrl = new URL(fetch.mock.calls[1][0]);
        expect(commentsUrl.searchParams.get('entityId')).toBe('2878676');
        expect(commentsUrl.searchParams.get('entityType')).toBe('74');
        expect(commentsUrl.searchParams.get('order')).toBe('1');
    });

    it('uses a numeric ID as a moment entity after the discussion probe misses', async () => {
        const fetch = vi.fn()
            .mockResolvedValueOnce(response({ success: false, code: -1, msg: 'not found', data: null }))
            .mockResolvedValueOnce(commentPage([comment(103, { frequencyData: {} })]));
        vi.stubGlobal('fetch', fetch);

        await command.func({ id: '2878676', limit: 1 });

        expect(fetch.mock.calls[0][0]).toContain('/content-data/detail/2878676');
        const commentsUrl = new URL(fetch.mock.calls[1][0]);
        expect(commentsUrl.searchParams.get('entityId')).toBe('2878676');
        expect(commentsUrl.searchParams.get('entityType')).toBe('74');
    });

    it('uses numeric /feed/main/detail IDs directly as moment entities', async () => {
        const fetch = vi.fn().mockResolvedValue(commentPage([comment(104, { frequencyData: {} })]));
        vi.stubGlobal('fetch', fetch);

        await command.func({ id: 'https://www.nowcoder.com/feed/main/detail/2878676', limit: 1 });

        expect(fetch).toHaveBeenCalledTimes(1);
        const commentsUrl = new URL(fetch.mock.calls[0][0]);
        expect(commentsUrl.pathname).toBe('/api/sparta/comment/list-by-page');
        expect(commentsUrl.searchParams.get('entityId')).toBe('2878676');
        expect(commentsUrl.searchParams.get('entityType')).toBe('74');
    });

    it('expands replies and reconstructs root, parent, depth, and author relationships', async () => {
        const root = comment(100, {
            authorId: 1,
            userBrief: { userId: 1, nickname: 'Root author' },
            frequencyData: { likeCnt: 5, commentCnt: 5, totalCommentCnt: 5 },
        });
        const directReply = comment(200, {
            authorId: 2,
            userBrief: { userId: 2, nickname: 'Bob' },
            entryId: 100,
            entryType: 2,
            toCommentId: 100,
            toUserId: 1,
            toUserBrief: null,
            pureText: 'reply to root',
            frequencyData: { likeCnt: 2, commentCnt: 0, totalCommentCnt: 0 },
        });
        const nestedReply = comment(300, {
            authorId: 3,
            userBrief: { userId: 3, nickname: 'Carol' },
            entryId: 100,
            entryType: 2,
            toCommentId: 200,
            toUserId: 2,
            toUserBrief: null,
            pureText: 'reply to Bob',
            frequencyData: { likeCnt: 1, commentCnt: 0, totalCommentCnt: 0 },
        });
        const fetch = vi.fn()
            .mockResolvedValueOnce(commentPage([root]))
            .mockResolvedValueOnce(commentPage([directReply, nestedReply]));
        vi.stubGlobal('fetch', fetch);

        const rows = await command.func({
            id: 'https://www.nowcoder.com/discuss/1656390',
            'with-replies': true,
            limit: 1,
            'replies-limit': 20,
        });

        expect(fetch).toHaveBeenCalledTimes(2);
        const replyUrl = new URL(fetch.mock.calls[1][0]);
        expect(replyUrl.searchParams.get('entityId')).toBe('100');
        expect(replyUrl.searchParams.get('entityType')).toBe('2');
        expect(rows.map(row => row.id)).toEqual(['100', '200', '300']);
        expect(rows.map(row => row.root_id)).toEqual(['100', '100', '100']);
        expect(rows.map(row => row.parent_id)).toEqual(['', '100', '200']);
        expect(rows.map(row => row.depth)).toEqual([0, 1, 2]);
        expect(rows.map(row => row.ancestry_complete)).toEqual([true, true, true]);
        expect(rows.map(row => row.replies)).toEqual([5, 0, 0]);
        expect(rows.map(row => row.direct_replies)).toEqual([1, 1, 0]);
        expect(rows[1]).toMatchObject({
            author_id: '2',
            author: 'Bob',
            reply_to_author_id: '1',
            reply_to_author: 'Root author',
        });
        expect(rows[2]).toMatchObject({
            author_id: '3',
            author: 'Carol',
            reply_to_author_id: '2',
            reply_to_author: 'Bob',
        });

        const reported = __test__.filterAndSortRows(rows, __test__.buildFilters({
            'min-replies': 1,
            sort: 'replies',
        }));
        expect(reported.map(row => row.id)).toEqual(['100']);

        const mined = __test__.filterAndSortRows(rows, __test__.buildFilters({
            'min-direct-replies': 1,
            sort: 'direct-replies',
        }));
        expect(mined.map(row => row.id)).toEqual(['100', '200']);
    });

    it('orders an incomplete component parent-first while retaining unknown depth', async () => {
        const root = comment(22726094, {
            frequencyData: { likeCnt: 1, totalCommentCnt: 5 },
        });
        const parent = comment(22728357, {
            authorId: 943123728,
            userBrief: { userId: 943123728, nickname: 'offer来' },
            entryId: 22726094,
            entryType: 2,
            toCommentId: 22726100,
            toUserId: 393462489,
            pureText: 'parent whose own parent was truncated',
            frequencyData: {},
        });
        const child = comment(22728836, {
            authorId: 123,
            userBrief: { userId: 123, nickname: 'child author' },
            entryId: 22726094,
            entryType: 2,
            toCommentId: 22728357,
            toUserId: 943123728,
            pureText: 'child returned before its fetched parent',
            frequencyData: {},
        });
        const fetch = vi.fn()
            .mockResolvedValueOnce(commentPage([root]))
            .mockResolvedValueOnce(commentPage([child, parent]));
        vi.stubGlobal('fetch', fetch);

        const rows = await command.func({
            id: 'https://www.nowcoder.com/discuss/1656390',
            'with-replies': true,
            limit: 1,
            'replies-limit': 2,
            order: 'hot',
        });

        expect(rows.map(row => row.id)).toEqual(['22726094', '22728357', '22728836']);
        expect(rows[1]).toMatchObject({
            root_id: '22726094',
            parent_id: '22726100',
            depth: null,
            ancestry_complete: false,
            author_id: '943123728',
        });
        expect(rows[2]).toMatchObject({
            parent_id: '22728357',
            depth: null,
            ancestry_complete: false,
        });
        expect(rows.map(row => row.replies)).toEqual([5, 0, 0]);
        expect(rows.map(row => row.direct_replies)).toEqual([0, 1, 0]);
    });

    it('walks top-level pages until the scan limit is reached', async () => {
        const firstPage = Array.from({ length: 20 }, (_, index) => comment(index + 1, { frequencyData: {} }));
        const secondPage = Array.from({ length: 20 }, (_, index) => comment(index + 21, { frequencyData: {} }));
        const fetch = vi.fn()
            .mockResolvedValueOnce(commentPage(firstPage, { current: 1, totalPage: 3 }))
            .mockResolvedValueOnce(commentPage(secondPage, { current: 2, totalPage: 3 }));
        vi.stubGlobal('fetch', fetch);

        const rows = await command.func({
            id: 'https://www.nowcoder.com/discuss/1656390',
            page: 1,
            limit: 25,
            order: 'hot',
        });

        expect(rows).toHaveLength(25);
        expect(rows[24].id).toBe('25');
        expect(new URL(fetch.mock.calls[0][0]).searchParams.get('pageNo')).toBe('1');
        expect(new URL(fetch.mock.calls[1][0]).searchParams.get('pageNo')).toBe('2');
        expect(new URL(fetch.mock.calls[1][0]).searchParams.get('order')).toBe('2');
    });

    it('continues pagination until deduplication still yields the requested limit', async () => {
        const firstPage = Array.from({ length: 20 }, (_, index) => comment(index + 1, { frequencyData: {} }));
        const secondPage = [
            comment(20, { frequencyData: {} }),
            ...Array.from({ length: 19 }, (_, index) => comment(index + 21, { frequencyData: {} })),
        ];
        const thirdPage = Array.from({ length: 20 }, (_, index) => comment(index + 40, { frequencyData: {} }));
        const fetch = vi.fn()
            .mockResolvedValueOnce(commentPage(firstPage, { current: 1, totalPage: 3 }))
            .mockResolvedValueOnce(commentPage(secondPage, { current: 2, totalPage: 3 }))
            .mockResolvedValueOnce(commentPage(thirdPage, { current: 3, totalPage: 3 }));
        vi.stubGlobal('fetch', fetch);

        const rows = await command.func({
            id: 'https://www.nowcoder.com/discuss/1656390',
            limit: 40,
        });

        expect(fetch).toHaveBeenCalledTimes(3);
        expect(rows).toHaveLength(40);
        expect(rows.at(-1).id).toBe('40');
        expect(new URL(fetch.mock.calls[2][0]).searchParams.get('pageNo')).toBe('3');
    });

    it('continues past a short non-final page when totalPage confirms later pages', async () => {
        const firstPage = Array.from({ length: 20 }, (_, index) => comment(index + 1, { frequencyData: {} }));
        const duplicateShortPage = Array.from({ length: 10 }, (_, index) => comment(index + 1, { frequencyData: {} }));
        const finalPage = Array.from({ length: 5 }, (_, index) => comment(index + 21, { frequencyData: {} }));
        const fetch = vi.fn()
            .mockResolvedValueOnce(commentPage(firstPage, { current: 1, totalPage: 3 }))
            .mockResolvedValueOnce(commentPage(duplicateShortPage, { current: 2, totalPage: 3 }))
            .mockResolvedValueOnce(commentPage(finalPage, { current: 3, totalPage: 3 }));
        vi.stubGlobal('fetch', fetch);

        const rows = await command.func({
            id: 'https://www.nowcoder.com/discuss/1656390',
            limit: 25,
        });

        expect(fetch).toHaveBeenCalledTimes(3);
        expect(rows.map(row => row.id)).toEqual(Array.from({ length: 25 }, (_, index) => String(index + 1)));
        expect(new URL(fetch.mock.calls[2][0]).searchParams.get('pageNo')).toBe('3');
    });

    it('stops on an empty page even when totalPage is stale', async () => {
        const fetch = vi.fn()
            .mockResolvedValueOnce(commentPage([comment(1, { frequencyData: {} })], { current: 1, totalPage: 1000 }))
            .mockResolvedValueOnce(commentPage([], { current: 2, totalPage: 1000 }));
        vi.stubGlobal('fetch', fetch);

        const rows = await command.func({
            id: 'https://www.nowcoder.com/discuss/1656390',
            limit: 2,
        });

        expect(fetch).toHaveBeenCalledTimes(2);
        expect(rows.map(row => row.id)).toEqual(['1']);
    });

    it('filters by engagement, author, text, and time', async () => {
        const records = [
            comment(1, {
                authorId: 11,
                userBrief: { userId: 11, nickname: 'Agent Expert' },
                pureText: 'Agent memory is useful',
                createTime: Date.parse('2026-07-10T00:00:00Z'),
                frequencyData: { likeCnt: 10, totalCommentCnt: 3 },
            }),
            comment(2, {
                authorId: 12,
                userBrief: { userId: 12, nickname: 'Agent Newbie' },
                pureText: 'Agent question',
                createTime: Date.parse('2026-07-12T00:00:00Z'),
                frequencyData: { likeCnt: 1, totalCommentCnt: 0 },
            }),
            comment(3, {
                authorId: 11,
                userBrief: { userId: 11, nickname: 'Agent Expert' },
                pureText: 'Java discussion',
                createTime: Date.parse('2026-06-01T00:00:00Z'),
                frequencyData: { likeCnt: 20, totalCommentCnt: 5 },
            }),
        ];
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(commentPage(records)));

        const rows = await command.func({
            id: 'https://www.nowcoder.com/discuss/1656390',
            'min-likes': 5,
            'min-replies': 1,
            'author-id': '11',
            author: 'expert',
            contains: 'memory',
            since: '2026-07-01',
            until: '2026-07-31',
        });

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ id: '1', author_id: '11', likes: 10, replies: 3 });
    });

    it('sorts matching comments by likes, replies, or time', async () => {
        const records = [
            comment(1, { createTime: 1000, frequencyData: { likeCnt: 1, totalCommentCnt: 8 } }),
            comment(2, { createTime: 3000, frequencyData: { likeCnt: 9, totalCommentCnt: 1 } }),
            comment(3, { createTime: 2000, frequencyData: { likeCnt: 5, totalCommentCnt: 3 } }),
        ];
        const run = async (sort) => {
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue(commentPage(records)));
            return command.func({ id: 'https://www.nowcoder.com/discuss/1656390', sort });
        };

        expect((await run('likes')).map(row => row.id)).toEqual(['2', '3', '1']);
        expect((await run('replies')).map(row => row.id)).toEqual(['1', '3', '2']);
        expect((await run('time')).map(row => row.id)).toEqual(['2', '3', '1']);
    });

    it('preserves code in plain-text fields and only strips legacy HTML content', async () => {
        const fetch = vi.fn().mockResolvedValue(commentPage([
            comment(1, { pureText: 'vector<int> and a < b && c > d', frequencyData: {} }),
            comment(2, { pureText: '', contentV2: '{"pureText":"vector<int>\\nvalue"}', content: '<b>ignored</b>', frequencyData: {} }),
            comment(3, { pureText: '', contentV2: '{broken', content: '<p>A &amp; B</p>', frequencyData: {} }),
        ]));
        vi.stubGlobal('fetch', fetch);

        const rows = await command.func({ id: 'https://www.nowcoder.com/discuss/1656390' });
        expect(rows.map(row => row.content)).toEqual([
            'vector<int> and a < b && c > d',
            'vector<int> value',
            'A & B',
        ]);
        const containingCode = __test__.filterAndSortRows(rows, __test__.buildFilters({ contains: 'vector<int>' }));
        expect(containingCode.map(row => row.id)).toEqual(['1', '2']);
    });

    it('rejects invalid targets and mining options before fetching', async () => {
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);

        await expect(command.func({ id: 'https://evil.example/discuss/1' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ id: '1', page: 0 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ id: '1', limit: 101 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ id: '1', 'replies-limit': 101 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ id: '1', 'min-likes': -1 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ id: '1', 'min-direct-replies': -1 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ id: '1', 'min-direct-replies': 1 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ id: '1', 'author-id': 'abc' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ id: '1', 'author-id': '0' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ id: '1', since: 'not-a-date' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ id: '1', since: '2026-08-01', until: '2026-07-01' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ id: '1', order: 'oldest' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ id: '1', sort: 'author' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ id: '1', sort: 'direct-replies' })).rejects.toBeInstanceOf(ArgumentError);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('maps empty, filtered-empty, malformed, and failed responses to typed errors', async () => {
        const run = async (payload, args = {}) => {
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(payload)));
            return command.func({ id: 'https://www.nowcoder.com/discuss/1656390', ...args });
        };

        await expect(run({ success: true, code: 0, data: { current: 1, size: 20, totalPage: 1, records: [] } }))
            .rejects.toBeInstanceOf(EmptyResultError);
        await expect(run({ success: true, code: 0, data: { records: {} } }))
            .rejects.toBeInstanceOf(CommandExecutionError);
        await expect(run({ success: true, code: 0, data: { current: 1, size: 20, totalPage: 1, records: [{}] } }))
            .rejects.toBeInstanceOf(CommandExecutionError);
        await expect(run({ success: false, code: 500, msg: 'failed', data: null }))
            .rejects.toBeInstanceOf(CommandExecutionError);
        await expect(run({
            success: true,
            code: 0,
            data: { current: 1, size: 20, totalPage: 1, records: [comment(1, { frequencyData: { likeCnt: 0 } })] },
        }, { 'min-likes': 1 })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('does not hide unexpected detail API failures as missing posts', async () => {
        const fetch = vi.fn().mockResolvedValue(response({
            success: false,
            code: 500,
            msg: 'server error',
            data: null,
        }));
        vi.stubGlobal('fetch', fetch);

        await expect(command.func({ id: '2878676' })).rejects.toBeInstanceOf(CommandExecutionError);
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});
