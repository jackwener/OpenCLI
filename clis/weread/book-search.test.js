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

function readerHtml({ bookId = 'book-1', title = '史记', author = '司马迁', chapters = [] } = {}) {
    const state = {
        reader: {
            infoId: 'reader-1',
            bookId,
            bookInfo: { bookId, title, author, encodeId: 'reader-1' },
            chapterInfos: chapters,
        },
    };
    return `
      <html>
        <head>
          <script type="application/ld+json">{"@Id":"${bookId}","name":"${title}","author":{"name":"${author}"},"url":"https://weread.qq.com/web/reader/reader-1"}</script>
        </head>
        <body>
          <script>window.__INITIAL_STATE__=${JSON.stringify(state)};(function(){var s;(s=document.currentScript).parentNode.removeChild(s);}());</script>
        </body>
      </html>
    `;
}

describe('weread/book-search', () => {
    const command = getRegistry().get('weread/book-search');

    beforeEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('registers book-search with markdown default output', () => {
        expect(command?.defaultFormat).toBe('md');
    });

    it('resolves a book by title, reads reader chapter metadata, and searches inside the book', async () => {
        expect(command?.func).toBeTypeOf('function');
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({
            books: [
                {
                    bookInfo: {
                        title: '史记',
                        author: '司马迁',
                        bookId: 'book-1',
                    },
                },
            ],
        }))
            .mockResolvedValueOnce(textResponse(`
          <ul class="search_bookDetail_list">
            <li class="wr_bookList_item">
              <a class="wr_bookList_item_link" href="/web/reader/reader-1"></a>
              <p class="wr_bookList_item_title">史记</p>
              <p class="wr_bookList_item_author">司马迁</p>
            </li>
          </ul>
        `))
            .mockResolvedValueOnce(textResponse(readerHtml({
            bookId: 'book-1',
            title: '史记',
            author: '司马迁',
            chapters: [
                { chapterUid: 171, chapterIdx: 9, title: '卷一 五帝本纪第一' },
            ],
        })))
            .mockResolvedValueOnce(jsonResponse({
            result: [
                {
                    chapterUid: 171,
                    abstract: '尧、舜二帝举贤任能，天下大治。',
                    absStart: 100,
                    absEnd: 118,
                    keyword: ['舜'],
                    searchIdx: 1,
                },
            ],
            hasMore: 0,
        }));
        vi.stubGlobal('fetch', fetchMock);

        const result = await command.func({ book: '史记', query: '舜', limit: 5, 'book-rank': 1 });

        expect(String(fetchMock.mock.calls[0][0])).toContain('/web/search/global?keyword=');
        expect(String(fetchMock.mock.calls[1][0])).toContain('/web/search/books?keyword=');
        expect(fetchMock.mock.calls[2][0]).toBe('https://weread.qq.com/web/reader/reader-1');
        expect(String(fetchMock.mock.calls[3][0])).toContain('/web/book/search?bookId=book-1');
        expect(String(fetchMock.mock.calls[3][0])).toContain('keyword=%E8%88%9C');
        expect(result).toEqual([
            {
                markdown: [
                    '# 史记',
                    '- author: 司马迁',
                    '- book_id: `book-1`',
                    '- query: `舜`',
                    '- matches: 1',
                    '- url: https://weread.qq.com/web/reader/reader-1',
                    '',
                    '## 1. 卷一 五帝本纪第一',
                    '',
                    '> 尧、舜二帝举贤任能，天下大治。',
                    '',
                    '- chapter_idx: 9',
                    '- chapter_uid: 171',
                    '- search_idx: 1',
                ].join('\n'),
            },
        ]);
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

    it('throws EMPTY_RESULT when no book matches the title query', async () => {
        expect(command?.func).toBeTypeOf('function');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ books: [] })));

        await expect(command.func({ book: 'not-a-book', query: 'x' })).rejects.toMatchObject({
            code: 'EMPTY_RESULT',
        });
    });

    it('fails closed when the book search payload is malformed', async () => {
        expect(command?.func).toBeTypeOf('function');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ result: [] })));

        await expect(command.func({ book: '史记', query: '舜' })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: 'WeRead book search returned malformed books',
        });
    });

    it('rejects off-domain reader URLs instead of fetching arbitrary pages', async () => {
        expect(command?.func).toBeTypeOf('function');

        await expect(command.func({ book: 'https://example.com/web/reader/reader-1', query: '舜' })).rejects.toMatchObject({
            code: 'ARGUMENT',
            message: 'book URL must be a https://weread.qq.com/web/reader/<id> URL',
        });
    });

    it('fails closed when in-book search results are malformed', async () => {
        expect(command?.func).toBeTypeOf('function');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ result: [{ searchIdx: 1 }], hasMore: 0 })));

        await expect(command.func({ book: '123', query: '舜', raw: true })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: 'WeRead in-book search returned malformed match',
        });
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

    it('validates numeric arguments instead of silently clamping', async () => {
        expect(command?.func).toBeTypeOf('function');
        await expect(command.func({ book: '史记', query: '舜', limit: 101 })).rejects.toMatchObject({
            code: 'ARGUMENT',
            message: 'limit must be <= 100',
        });
    });
});
