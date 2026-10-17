import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { buildCommentRows } from './answer-comments-helpers.js';
import './answer-comments.js';

const command = () => getRegistry().get('zhihu/answer-comments');
const args = (overrides = {}) => ({
    id: '20',
    limit: 1,
    'replies-limit': 0,
    order: 'score',
    ...overrides,
});

function pageWith(resolve) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        getCurrentUrl: vi.fn().mockResolvedValue('https://www.zhihu.com/question/10/answer/20'),
        evaluate: vi.fn().mockImplementation((_fn, url) => resolve(url)),
    };
}

function root(id, content = `root ${id}`, extra = {}) {
    return {
        id,
        author: { member: { name: `author ${id}` } },
        child_comment_count: 0,
        content,
        ...extra,
    };
}

function child(id, rootId, parentId, content = `reply ${id}`, extra = {}) {
    return {
        id,
        reply_root_comment_id: rootId,
        reply_comment_id: parentId,
        author: { member: { name: `author ${id}` } },
        content,
        ...extra,
    };
}

describe('zhihu answer-comments', () => {

    it.each(['root', 'child'])('follows server-sized %s pages beyond the old fetch budget', async (role) => {
        let count = 0;
        const page = pageWith(async (url) => {
            if (role === 'child' && url.includes('/root_comment')) {
                return { data: [root('100', 'root', { child_comment_count: 60 })], paging: { is_end: true } };
            }
            const items = Array.from({ length: 10 }, (_, i) => {
                const id = String(200 + count * 10 + i);
                return role === 'root' ? root(id) : child(id, '100', '100');
            });
            count += 1;
            const path = role === 'root' ? 'answers/20/root_comment' : 'comment/100/child_comment';
            const order = role === 'root' ? '&order_by=score' : '';
            return { data: items, paging: { is_end: count === 6,
                next: `https://www.zhihu.com/api/v4/comment_v5/${path}?limit=10&offset=${count}${order}` } };
        });
        const rows = await command().func(page, args(role === 'root' ? { limit: 60 } : { 'replies-limit': 60 }));
        expect(rows).toHaveLength(role === 'root' ? 60 : 61);
        expect(count).toBe(6);
    });

    it('counts unique roots toward limit and idempotently removes equivalent page overlap', async () => {
        const page = pageWith(vi.fn()
            .mockResolvedValueOnce({
                data: [root('100'), root('101')],
                paging: {
                    is_end: false,
                    next: 'https://www.zhihu.com/api/v4/comment_v5/answers/20/root_comment?order_by=score&limit=20&offset=next',
                },
            })
            .mockResolvedValueOnce({
                data: [
                    root('101', 'root 101', { like_count: 99 }),
                    root('102'),
                ],
                paging: { is_end: true },
            }));

        const rows = await command().func(page, args({ limit: 3 }));
        expect(rows.map((row) => row.id)).toEqual(['100', '101', '102']);
        expect(page.evaluate).toHaveBeenCalledTimes(2);
    });

    it('rejects same-id root overlap when normalized content or role identity conflicts', async () => {
        const page = pageWith(vi.fn()
            .mockResolvedValueOnce({
                data: [root('100')],
                paging: {
                    is_end: false,
                    next: 'https://www.zhihu.com/api/v4/comment_v5/answers/20/root_comment?order_by=score&limit=20&offset=next',
                },
            })
            .mockResolvedValueOnce({
                data: [root('100', 'different content')],
                paging: { is_end: true },
            }));

        await expect(command().func(page, args({ limit: 2 }))).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('counts unique replies toward replies-limit and removes equivalent child overlap', async () => {
        let childPage = 0;
        const page = pageWith(async (url) => {
            if (url.includes('/root_comment')) {
                return {
                    data: [root('100', 'root', { child_comment_count: 3 })],
                    paging: { is_end: true },
                };
            }
            childPage += 1;
            if (childPage === 1) {
                return {
                    data: [child('101', '100', '100'), child('102', '100', '100')],
                    paging: {
                        is_end: false,
                        next: 'https://www.zhihu.com/api/v4/comment_v5/comment/100/child_comment?limit=20&offset=next',
                    },
                };
            }
            return {
                data: [
                    child('102', '100', '100', 'reply 102', { like_count: 9 }),
                    child('103', '100', '102'),
                ],
                paging: { is_end: true },
            };
        });

        const rows = await command().func(page, args({ 'replies-limit': 3 }));
        expect(rows.map((row) => row.id)).toEqual(['100', '101', '102', '103']);
        expect(page.evaluate).toHaveBeenCalledTimes(3);
    });

    it('rejects conflicting child overlap and wrong root provenance', async () => {
        const conflictingOverlap = pageWith(vi.fn()
            .mockResolvedValueOnce({
                data: [root('100', 'root', { child_comment_count: 2 })],
                paging: { is_end: true },
            })
            .mockResolvedValueOnce({
                data: [child('101', '100', '100')],
                paging: {
                    is_end: false,
                    next: 'https://www.zhihu.com/api/v4/comment_v5/comment/100/child_comment?limit=20&offset=next',
                },
            })
            .mockResolvedValueOnce({
                data: [child('101', '100', '100', 'changed')],
                paging: { is_end: true },
            }));
        await expect(command().func(conflictingOverlap, args({ 'replies-limit': 2 })))
            .rejects.toBeInstanceOf(CommandExecutionError);

        const wrongRoot = pageWith(async (url) => url.includes('/root_comment')
            ? { data: [root('100', 'root', { child_comment_count: 1 })], paging: { is_end: true } }
            : { data: [child('101', '999', '100')], paging: { is_end: true } });
        await expect(command().func(wrongRoot, args({ 'replies-limit': 1 })))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('requires exact answer/root/order pagination provenance', async () => {
        for (const next of [
            ...['0', '-1', 'abc', '1.5', ''].map(size =>
                `https://www.zhihu.com/api/v4/comment_v5/answers/20/root_comment?order_by=score&limit=${size}&offset=x`),
            'https://evil.example/api/v4/comment_v5/answers/20/root_comment?order_by=score&limit=20&offset=x',
            'https://www.zhihu.com/api/v4/comment_v5/answers/21/root_comment?order_by=score&limit=20&offset=x',
            'https://www.zhihu.com/api/v4/comment_v5/answers/20/root_comment?order_by=ts&limit=20&offset=x',
        ]) {
            const page = pageWith(async () => ({
                data: [root('100')],
                paging: { is_end: false, next },
            }));
            await expect(command().func(page, args({ limit: 2 }))).rejects.toBeInstanceOf(CommandExecutionError);
        }

        const childWrongRoot = pageWith(async (url) => url.includes('/root_comment')
            ? { data: [root('100', 'root', { child_comment_count: 2 })], paging: { is_end: true } }
            : {
                data: [child('101', '100', '100')],
                paging: {
                    is_end: false,
                    next: 'https://www.zhihu.com/api/v4/comment_v5/comment/999/child_comment?limit=20&offset=x',
                },
            });
        await expect(command().func(childWrongRoot, args({ 'replies-limit': 2 })))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('fails repeated URLs and unique-URL stalls within a bounded page budget', async () => {
        const repeated = pageWith(async () => ({
            data: [root('100')],
            paging: {
                is_end: false,
                next: 'https://www.zhihu.com/api/v4/comment_v5/answers/20/root_comment?order_by=score&limit=20&offset=',
            },
        }));
        await expect(command().func(repeated, args({ limit: 2 }))).rejects.toBeInstanceOf(CommandExecutionError);

        let offset = 0;
        const stalled = pageWith(async () => {
            offset += 1;
            return {
                data: [root('100')],
                paging: {
                    is_end: false,
                    next: `https://www.zhihu.com/api/v4/comment_v5/answers/20/root_comment?order_by=score&limit=20&offset=${offset}`,
                },
            };
        });
        await expect(command().func(stalled, args({ limit: 2 }))).rejects.toBeInstanceOf(CommandExecutionError);
        expect(stalled.evaluate).toHaveBeenCalledTimes(3);
    });

});

describe('zhihu answer-comments graph', () => {
    const context = { answerId: '20', questionId: '10' };

    it('preserves exact depth beyond ten levels without recursive traversal', () => {
        const children = Array.from({ length: 12 }, (_, index) => {
            const id = String(101 + index);
            const parentId = index === 0 ? '100' : String(100 + index);
            return child(id, '100', parentId);
        });
        const rows = buildCommentRows(
            [root('100')],
            new Map([['100', children]]),
            context,
        );
        expect(rows.slice(1).map((row) => row.depth)).toEqual(
            Array.from({ length: 12 }, (_, index) => index + 1),
        );
    });

    it('rejects cycles, unknown parents, and ids reused across graph roles or roots', () => {
        expect(() => buildCommentRows(
            [root('100')],
            new Map([['100', [child('101', '100', '102'), child('102', '100', '101')]]]),
            context,
        )).toThrow(CommandExecutionError);
        expect(() => buildCommentRows(
            [root('100')],
            new Map([['100', [child('101', '100', '999')]]]),
            context,
        )).toThrow(CommandExecutionError);
        expect(() => buildCommentRows(
            [root('100')],
            new Map([['100', [child('100', '100', '100')]]]),
            context,
        )).toThrow(CommandExecutionError);
        expect(() => buildCommentRows(
            [root('100'), root('200')],
            new Map([
                ['100', [child('300', '100', '100')]],
                ['200', [child('300', '200', '200')]],
            ]),
            context,
        )).toThrow(CommandExecutionError);
    });
});
