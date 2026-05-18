import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import {
    ArgumentError,
    AuthRequiredError,
    EmptyResultError,
} from '@jackwener/opencli/errors';

import './search.js';
import './shelf.js';
import './book.js';
import './notes.js';
import './review.js';
import './readdata.js';
import './discover.js';
import './list-apis.js';

function jsonResponse(body, ok = true, status = 200) {
    return {
        ok,
        status,
        json: vi.fn().mockResolvedValue(body),
        text: vi.fn().mockResolvedValue(JSON.stringify(body)),
    };
}

function stubGateway(...payloads) {
    const mock = vi.fn();
    for (const payload of payloads) {
        mock.mockResolvedValueOnce(jsonResponse(payload));
    }
    vi.stubGlobal('fetch', mock);
    return mock;
}

beforeEach(() => {
    vi.stubEnv('WEREAD_API_KEY', 'wrk-test');
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe('weread-official command registration', () => {
    it('registers eight read-only public commands without browser dependency', () => {
        const registry = getRegistry();
        const expected = ['search', 'shelf', 'book', 'notes', 'review', 'readdata', 'discover', 'list-apis'];
        for (const name of expected) {
            const command = registry.get(`weread-official/${name}`);
            expect(command, `weread-official/${name}`).toBeDefined();
            expect(command.access).toBe('read');
            expect(command.strategy).toBe('public');
            expect(command.browser).toBe(false);
            expect(command.domain).toBe('weread.qq.com');
        }
    });
});

describe('weread-official search', () => {
    const search = () => getRegistry().get('weread-official/search').func;

    it('maps scope alias, flattens params, surfaces rating + searchIdx', async () => {
        const mock = stubGateway({
            errcode: 0,
            results: [{
                title: '电子书', scope: 10, scopeCount: 2, books: [
                    {
                        searchIdx: 1, readingCount: 1000, newRating: 950,
                        bookInfo: { bookId: 'b1', title: '三体', author: '刘慈欣', category: '科幻', cover: 'cover1', intro: '...' },
                    },
                    {
                        searchIdx: 2, readingCount: 200, newRating: 0,
                        bookInfo: { bookId: 'b2', title: '三体II', author: '刘慈欣' },
                    },
                ],
            }],
        });
        const rows = await search()({ keyword: '三体', scope: 'ebook' });
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ rank: 1, scope: '电子书', bookId: 'b1', title: '三体', searchIdx: 1, readingCount: 1000 });
        expect(rows[0].rating).toMatch(/神作/);
        expect(rows[0].link).toBe('weread://reading?bId=b1');
        expect(rows[1].rating).toBe('暂无');
        // verify the request body
        const [, init] = mock.mock.calls[0];
        const body = JSON.parse(init.body);
        expect(body.scope).toBe(10);
        expect(body.keyword).toBe('三体');
        expect(body.skill_version).toBeDefined();
    });

    it('rejects empty keyword and unknown scope before fetch', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const fn = search();
        await expect(fn({ keyword: ' ' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(fn({ keyword: '三体', scope: 'movie' })).rejects.toBeInstanceOf(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws EmptyResultError when the gateway returns no groups', async () => {
        stubGateway({ errcode: 0, results: [] });
        await expect(search()({ keyword: '三体' })).rejects.toBeInstanceOf(EmptyResultError);
    });
});

describe('weread-official shelf', () => {
    const shelf = () => getRegistry().get('weread-official/shelf').func;

    it('returns books + albums + mp entry in a single flat list', async () => {
        stubGateway({
            errcode: 0,
            books: [
                { bookId: 'b1', title: '三体', author: '刘慈欣', category: '科幻', isTop: 1, secret: 0, finishReading: 1, readUpdateTime: 1748563200, cover: 'c1' },
            ],
            albums: [
                {
                    albumInfo: { albumId: 'a1', name: '红楼梦广播剧', authorName: '播主', finish: 1, cover: 'cover-a', updateTime: 1700000000 },
                    albumInfoExtra: { secret: 1, isTop: 0, lectureReadUpdateTime: 1748000000 },
                },
            ],
            mp: { entry: 'present' },
        });
        const rows = await shelf()({});
        expect(rows).toHaveLength(3);
        expect(rows[0]).toMatchObject({ kind: 'book', id: 'b1', isTop: true, finished: true, secret: false });
        expect(rows[0].link).toBe('weread://reading?bId=b1');
        expect(rows[1]).toMatchObject({ kind: 'album', id: 'a1', title: '红楼梦广播剧', author: '播主', secret: true, finished: true });
        expect(rows[2]).toMatchObject({ kind: 'mp', title: '文章收藏', secret: true });
    });

    it('omits mp row when mp is empty / absent', async () => {
        stubGateway({ errcode: 0, books: [{ bookId: 'b1', title: 't' }], albums: [], mp: {} });
        const rows = await shelf()({});
        expect(rows.map((r) => r.kind)).toEqual(['book']);
    });

    it('throws EmptyResultError on a fully empty shelf', async () => {
        stubGateway({ errcode: 0, books: [], albums: [] });
        await expect(shelf()({})).rejects.toBeInstanceOf(EmptyResultError);
    });
});

describe('weread-official book', () => {
    const book = () => getRegistry().get('weread-official/book').func;

    it('runs all three calls by default and groups output into sections', async () => {
        const fetchMock = stubGateway(
            { errcode: 0, bookId: 'b1', title: '三体', author: '刘慈欣', newRating: 920, intro: 'intro', cover: 'cov' },
            { errcode: 0, chapters: [{ chapterUid: 107, chapterIdx: 1, title: 'Ch1', wordCount: 1234, level: 1, paid: 1, price: 0 }] },
            { errcode: 0, book: { chapterUid: 107, progress: 45, recordReadingTime: 3660, updateTime: 1748563200, isStartReading: 1 } },
        );
        const rows = await book()({ bookId: 'b1' });
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(rows.find((r) => r.section === 'info' && r.key === 'title').value).toBe('三体');
        expect(rows.find((r) => r.section === 'info' && r.key === 'rating').value).toMatch(/神作/);
        const chapterRow = rows.find((r) => r.section === 'chapter');
        expect(chapterRow).toMatchObject({ key: '107' });
        expect(chapterRow.link).toBe('weread://reading?bId=b1&chapterUid=107');
        const progressRow = rows.find((r) => r.section === 'progress' && r.key === 'progress');
        expect(progressRow.value).toBe('45%');
        const cumulative = rows.find((r) => r.section === 'progress' && r.key === 'cumulative');
        expect(cumulative.value).toBe('1小时1分钟');
    });

    it('skips /book/chapterinfo when --no-chapters and /book/getprogress when --no-progress', async () => {
        const fetchMock = stubGateway(
            { errcode: 0, bookId: 'b1', title: '三体' },
        );
        await book()({ bookId: 'b1', 'no-chapters': true, 'no-progress': true });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('rejects empty bookId before fetch', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(book()({ bookId: '' })).rejects.toBeInstanceOf(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('weread-official notes', () => {
    const notes = () => getRegistry().get('weread-official/notes').func;

    it('returns a notebooks overview with totalNotes = review + note + bookmark counts', async () => {
        stubGateway({
            errcode: 0,
            totalBookCount: 1,
            books: [{
                bookId: 'b1',
                book: { title: '三体', author: '刘慈欣' },
                reviewCount: 3, noteCount: 12, bookmarkCount: 4,
                readingProgress: 45, markedStatus: 0, sort: 1778312777,
            }],
            hasMore: 0,
        });
        const rows = await notes()({});
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ kind: 'notebook', bookId: 'b1', totalNotes: 19, reviewCount: 3, noteCount: 12, bookmarkCount: 4 });
    });

    it('merges /book/bookmarklist + /review/list/mine when bookId is provided', async () => {
        stubGateway(
            {
                errcode: 0,
                chapters: [{ chapterUid: 107, title: '第一章' }],
                updated: [{ bookmarkId: 'bm1', chapterUid: 107, markText: 'highlighted text', range: '900-2004', createTime: 1748563200 }],
            },
            {
                errcode: 0,
                reviews: [{ review: { reviewId: 'rv1', content: 'great chapter', chapterUid: 107, star: 100, isFinish: 0, createTime: 1748563200, chapterName: '第一章' } }],
            },
        );
        const rows = await notes()({ bookId: 'b1' });
        const highlight = rows.find((r) => r.kind === 'highlight');
        const thought = rows.find((r) => r.kind === 'thought');
        expect(highlight).toBeDefined();
        expect(thought).toBeDefined();
        expect(highlight.chapter).toBe('第一章');
        expect(highlight.range).toBe('900-2004');
        expect(highlight.link).toBe('weread://bestbookmark?bookId=b1&chapterUid=107&rangeStart=900&rangeEnd=2004');
        expect(thought.thought).toBe('great chapter');
    });

    it('throws EmptyResultError when both bookmarks and reviews are empty for a book', async () => {
        stubGateway(
            { errcode: 0, chapters: [], updated: [] },
            { errcode: 0, reviews: [] },
        );
        await expect(notes()({ bookId: 'b1' })).rejects.toBeInstanceOf(EmptyResultError);
    });
});

describe('weread-official review', () => {
    const review = () => getRegistry().get('weread-official/review').func;

    it('maps the type alias to reviewListType and shapes nested reviews', async () => {
        const mock = stubGateway({
            errcode: 0,
            reviewsCnt: 1,
            reviews: [{
                idx: 7,
                review: {
                    reviewId: 'rv1',
                    review: {
                        reviewId: 'rv1',
                        content: 'amazing',
                        star: 100,
                        isFinish: 1,
                        chapterName: '终章',
                        createTime: 1748563200,
                        author: { name: 'Alice' },
                    },
                },
            }],
        });
        const rows = await review()({ bookId: 'b1', type: 'recommend' });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ reviewId: 'rv1', author: 'Alice', isFinish: true, chapter: '终章' });
        expect(rows[0].starLabel).toBe('⭐⭐⭐⭐⭐');
        const body = JSON.parse(mock.mock.calls[0][1].body);
        expect(body.reviewListType).toBe(1);
    });

    it('rejects invalid type alias', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(review()({ bookId: 'b1', type: 'bogus' })).rejects.toBeInstanceOf(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('weread-official readdata', () => {
    const readdata = () => getRegistry().get('weread-official/readdata').func;

    it('produces summary + longest + readStat + preferCategory rows', async () => {
        stubGateway({
            errcode: 0,
            baseTime: 1748563200,
            readDays: 22,
            totalReadTime: 7320,
            dayAverageReadTime: 1200,
            compare: 0.2,
            readLongest: [{ book: { title: '三体', author: '刘慈欣' }, readTime: 3600, tags: ['笔记最多'] }],
            readStat: [{ stat: '读过', counts: '12本' }, { stat: '笔记', counts: '120条' }],
            preferCategory: [{ categoryTitle: '科幻', readingTime: 7200, readingCount: 3 }],
            preferAuthor: [{ name: '刘慈欣', readTime: '5小时30分钟', count: 4 }],
        });
        const rows = await readdata()({ mode: 'weekly' });
        const summaryTotal = rows.find((r) => r.section === 'summary' && r.key === 'totalReadTime');
        expect(summaryTotal.value).toBe('2小时2分钟');
        expect(summaryTotal.detail).toBe('7320s');
        const compare = rows.find((r) => r.section === 'summary' && r.key === 'compareToPrev');
        expect(compare.value).toBe('20.0%');
        expect(rows.some((r) => r.section === 'longest' && r.key === '三体')).toBe(true);
        expect(rows.some((r) => r.section === 'readStat' && r.key === '读过')).toBe(true);
        expect(rows.some((r) => r.section === 'preferCategory' && r.key === '科幻')).toBe(true);
        expect(rows.some((r) => r.section === 'preferAuthor' && r.key === '刘慈欣')).toBe(true);
    });

    it('rejects unknown mode before fetch', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(readdata()({ mode: 'fortnight' })).rejects.toBeInstanceOf(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('weread-official discover', () => {
    const discover = () => getRegistry().get('weread-official/discover').func;

    it('calls /book/recommend when no bookId provided', async () => {
        const mock = stubGateway({
            errcode: 0,
            books: [{ bookId: 'b1', title: '三体', author: '刘慈欣', newRating: 920, searchIdx: 1, reason: '科幻经典' }],
        });
        const rows = await discover()({});
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ mode: 'recommend', bookId: 'b1', reason: '科幻经典' });
        const body = JSON.parse(mock.mock.calls[0][1].body);
        expect(body.api_name).toBe('/book/recommend');
    });

    it('calls /book/similar when bookId given and unwraps booksimilar.books', async () => {
        const mock = stubGateway({
            errcode: 0,
            booksimilar: {
                sessionId: 'sess1',
                books: [{ idx: 1, book: { bookInfo: { bookId: 'b2', title: '三体II', author: '刘慈欣' } } }],
            },
        });
        const rows = await discover()({ bookId: 'b1' });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ mode: 'similar', bookId: 'b2', title: '三体II' });
        const body = JSON.parse(mock.mock.calls[0][1].body);
        expect(body.api_name).toBe('/book/similar');
        expect(body.bookId).toBe('b1');
    });
});

describe('weread-official list-apis', () => {
    const listApis = () => getRegistry().get('weread-official/list-apis').func;

    it('normalises gateway inventory shapes and appends a client SKILL_VERSION row', async () => {
        stubGateway({
            errcode: 0,
            apis: [
                { api_name: '/store/search', description: 'search store', required: ['keyword'], optional: ['scope', 'maxIdx'] },
                { name: '/shelf/sync', summary: 'shelf', params: { required: [], optional: [] } },
            ],
        });
        const rows = await listApis()({});
        expect(rows.find((r) => r.apiName === '/store/search')).toMatchObject({ required: 'keyword', optional: 'scope, maxIdx' });
        const client = rows[rows.length - 1];
        expect(client.apiName).toBe('(client)');
        expect(client.extras).toMatch(/^SKILL_VERSION=/);
    });

    it('throws EmptyResultError when the gateway returns no inventory shape', async () => {
        stubGateway({ errcode: 0, apis: [] });
        await expect(listApis()({})).rejects.toBeInstanceOf(EmptyResultError);
    });
});

describe('weread-official auth wiring', () => {
    it('every command refuses to run without WEREAD_API_KEY', async () => {
        vi.unstubAllEnvs();
        vi.stubEnv('WEREAD_API_KEY', '');
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        // pick a representative subset; each command's first call is callGateway which checks env first
        const cases = [
            ['search', { keyword: '三体' }],
            ['shelf', {}],
            ['book', { bookId: 'b1' }],
            ['readdata', { mode: 'weekly' }],
            ['list-apis', {}],
        ];
        for (const [name, args] of cases) {
            await expect(getRegistry().get(`weread-official/${name}`).func(args)).rejects.toBeInstanceOf(AuthRequiredError);
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
