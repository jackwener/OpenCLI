import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
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
    it('registers score/latest ordering and reconstructable hierarchy fields', () => {
        const cmd = command();
        expect(cmd).toBeDefined();
        expect(cmd.access).toBe('read');
        expect(cmd.strategy).toBe('cookie');
        expect(cmd.args.find((arg) => arg.name === 'order')).toMatchObject({
            default: 'score',
            choices: ['score', 'latest'],
        });
        expect(cmd.columns).toEqual([
            'rank', 'comment_rank', 'reply_rank', 'depth', 'id', 'parent_id',
            'author', 'reply_to', 'likes', 'created_at', 'url', 'content',
        ]);
    });

    it('uses comment_v5 and preserves root order plus exact reply depth', async () => {
        const page = pageWith(async (url) => {
            if (url.includes('/root_comment')) {
                expect(url).toContain('order_by=score');
                return {
                    data: [root('100', '<p>root</p>', {
                        child_comment_count: 3,
                        like_count: 4,
                        created_time: 1700000000,
                    })],
                    paging: { is_end: true },
                };
            }
            expect(url).toContain('/comment/100/child_comment');
            return {
                data: [
                    child('101', '100', '100', '<p>direct</p>', { like_count: 2 }),
                    child('102', '100', '101', '<p>nested</p>', {
                        reply_to_author: { member: { name: 'author 101' } },
                    }),
                    child('103', '100', '102', '<p>deep</p>', {
                        reply_to_author: { member: { name: 'author 102' } },
                    }),
                ],
                paging: { is_end: true },
            };
        });

        const rows = await command().func(page, args({
            id: 'answer:10:20',
            'replies-limit': 3,
        }));

        expect(rows.map((row) => [row.id, row.parent_id, row.depth, row.comment_rank, row.reply_rank])).toEqual([
            ['100', '', 0, 1, 0],
            ['101', '100', 1, 1, 1],
            ['102', '101', 2, 1, 2],
            ['103', '102', 3, 1, 3],
        ]);
        expect(rows[2]).toMatchObject({ author: 'author 102', reply_to: 'author 101', content: 'nested' });
        expect(page.evaluate).toHaveBeenCalledTimes(2);
    });

    it('maps latest to order_by=ts and sends no child request when replies-limit is zero', async () => {
        const page = pageWith(async (url) => {
            expect(url).toContain('order_by=ts');
            return {
                data: [root('100', 'root', { child_comment_count: 5 })],
                paging: { is_end: true },
            };
        });
        const rows = await command().func(page, args({ order: 'latest' }));
        expect(rows.map((row) => row.id)).toEqual(['100']);
        expect(page.evaluate).toHaveBeenCalledTimes(1);
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

    it('distinguishes auth, risk control, not found, empty, and malformed responses', async () => {
        await expect(command().func(pageWith(async () => ({ __httpStatus: 401 })), args()))
            .rejects.toBeInstanceOf(AuthRequiredError);
        await expect(command().func(pageWith(async () => ({
            __httpStatus: 403,
            __errorCode: 40362,
            __errorMessage: 'risk',
        })), args())).rejects.toBeInstanceOf(CommandExecutionError);
        await expect(command().func(pageWith(async () => ({
            __httpStatus: 403,
            __errorCode: 40353,
            __needLogin: true,
        })), args())).rejects.toBeInstanceOf(AuthRequiredError);
        await expect(command().func(pageWith(async () => ({ __httpStatus: 404 })), args()))
            .rejects.toBeInstanceOf(EmptyResultError);
        await expect(command().func(pageWith(async () => ({ data: [], paging: { is_end: true } })), args()))
            .rejects.toBeInstanceOf(EmptyResultError);
        await expect(command().func(pageWith(async () => ({ data: {}, paging: { is_end: true } })), args()))
            .rejects.toBeInstanceOf(CommandExecutionError);
        await expect(command().func(pageWith(async () => ({ data: [], paging: {} })), args()))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('rejects invalid inputs before navigation', async () => {
        const page = { goto: vi.fn(), evaluate: vi.fn() };
        await expect(command().func(page, args({ id: 'invalid' }))).rejects.toBeInstanceOf(ArgumentError);
        await expect(command().func(page, args({ limit: 0 }))).rejects.toBeInstanceOf(ArgumentError);
        await expect(command().func(page, args({ 'replies-limit': 101 }))).rejects.toBeInstanceOf(ArgumentError);
        await expect(command().func(page, args({ order: 'normal' }))).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
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
