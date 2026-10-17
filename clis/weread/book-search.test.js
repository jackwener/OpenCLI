import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './book-search.js';

function jsonResponse(body, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
    };
}

function textResponse(body, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: () => Promise.resolve(body),
    };
}

describe('weread/book-search', () => {
    const command = getRegistry().get('weread/book-search');

    beforeEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('uses book-rank to choose among search results and paginates by searchIdx', async () => {
        expect(command?.func).toBeTypeOf('function');
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({
            books: [
                { bookInfo: { title: '文明', author: '作者甲', bookId: 'wrong-book' } },
                { bookInfo: { title: '文明', author: '作者乙', bookId: 'right-book' } },
            ],
        }))
            .mockResolvedValueOnce(textResponse('<html></html>'))
            .mockResolvedValueOnce(jsonResponse({
            result: [
                { chapterUid: 1, abstract: 'first', searchIdx: 1 },
                { chapterUid: 1, abstract: 'second', searchIdx: 2 },
            ],
            hasMore: 1,
        }))
            .mockResolvedValueOnce(jsonResponse({
            result: [
                { chapterUid: 2, abstract: 'third', searchIdx: 3 },
            ],
            hasMore: 0,
        }));
        vi.stubGlobal('fetch', fetchMock);

        const result = await command.func({ book: '文明', query: '德', 'book-rank': 2, limit: 3, raw: true });

        expect(String(fetchMock.mock.calls[2][0])).toContain('bookId=right-book');
        expect(String(fetchMock.mock.calls[2][0])).toContain('maxIdx=0');
        expect(String(fetchMock.mock.calls[3][0])).toContain('maxIdx=2');
        expect(result.map((row) => row.snippet)).toEqual(['first', 'second', 'third']);
        expect(result.every((row) => row.book_id === 'right-book')).toBe(true);
    });

    it('fails closed when in-book pagination does not advance', async () => {
        expect(command?.func).toBeTypeOf('function');
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce(jsonResponse({
            result: [{ chapterUid: 1, abstract: 'first', searchIdx: 1 }],
            hasMore: 1,
        }))
            .mockResolvedValueOnce(jsonResponse({
            result: [{ chapterUid: 1, abstract: 'second', searchIdx: 1 }],
            hasMore: 1,
        })));

        await expect(command.func({ book: '123', query: '舜', limit: 2, raw: true })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: 'WeRead in-book search returned non-advancing searchIdx',
        });
    });

    it('fails closed when a full in-book search page has no pagination state', async () => {
        expect(command?.func).toBeTypeOf('function');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({
            result: Array.from({ length: 50 }, (_, index) => ({
                chapterUid: 1,
                abstract: `match ${index + 1}`,
                searchIdx: index + 1,
            })),
        })));

        await expect(command.func({ book: '123', query: '舜', limit: 51, raw: true })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: 'WeRead in-book search returned malformed pagination state',
        });
    });

});
