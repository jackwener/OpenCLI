import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import {
    getDoubanPhotoExtension,
    inferDoubanSearchResultType,
    loadDoubanMovieHot,
    loadDoubanSubjectDetail,
    loadDoubanSubjectPhotos,
    normalizeDoubanBookSubject,
    normalizeDoubanSubjectId,
    promoteDoubanPhotoUrl,
    resolveDoubanPhotoAssetUrl,
    searchDouban,
} from './utils.js';

function createFakeNode(text = '', attrs = {}) {
    return {
        textContent: text,
        getAttribute(name) {
            return attrs[name] || '';
        },
    };
}

function createFakeSearchItem({ title, url, rating, abstract, cover }) {
    return {
        querySelector(selector) {
            if (selector === '.title-text, .title a, .title h3 a, h3 a, a[title]') {
                return createFakeNode(title, { href: url, title });
            }
            if (selector === '.rating_nums') {
                return createFakeNode(rating);
            }
            if (selector === '.meta.abstract, .meta, .abstract, .subject-abstract, p') {
                return createFakeNode(abstract);
            }
            if (selector === 'a[href*="/subject/"]') {
                return createFakeNode('', { href: url });
            }
            if (selector === 'img') {
                return createFakeNode('', { src: cover });
            }
            return null;
        },
    };
}

function createFakeMovieHotItem({ title, url, info, rating, votes, cover }) {
    return {
        querySelector(selector) {
            if (selector === '.pl2 a') {
                return createFakeNode(title, { href: url });
            }
            if (selector === '.pl2 p') {
                return createFakeNode(info);
            }
            if (selector === '.star .pl') {
                return createFakeNode(votes);
            }
            if (selector === '.rating_nums') {
                return createFakeNode(rating);
            }
            if (selector === 'img') {
                return createFakeNode('', { src: cover });
            }
            return null;
        },
    };
}

function runMovieHotEvaluate(script, items) {
    const document = {
        querySelectorAll(selector) {
            return selector === '.item' ? items : [];
        },
    };

    return vm.runInNewContext(script, { document, URL });
}

async function runSearchEvaluate(script, rawItems, domItems) {
    const document = {
        querySelector(selector) {
            if (selector === '.item-root .title-text, .item-root .title a') {
                return domItems[0]?.querySelector('.title-text, .title a, .title h3 a, h3 a, a[title]') || null;
            }
            if (selector === '.item-root .title-text, .item-root .title a, .result-list .result-item h3 a') {
                return domItems[0]?.querySelector('.title-text, .title a, .title h3 a, h3 a, a[title]') || null;
            }
            return null;
        },
        querySelectorAll(selector) {
            if (selector === '.item-root') {
                return domItems;
            }
            if (selector === '.item-root, .result-list .result-item') {
                return domItems;
            }
            return [];
        },
    };

    return vm.runInNewContext(script, {
        Map,
        Promise,
        document,
        window: { __DATA__: { items: rawItems } },
        location: {
            href: 'https://search.douban.com/movie/subject_search?search_text=%E5%B0%84%E9%9B%95%E8%8B%B1%E9%9B%84%E4%BC%A0',
            origin: 'https://search.douban.com',
        },
        setTimeout(fn) {
            fn();
            return 0;
        },
    });
}

describe('douban utils', () => {
    it('normalizes valid subject ids', () => {
        expect(normalizeDoubanSubjectId(' 30382501 ')).toBe('30382501');
    });

    it('rejects invalid subject ids', () => {
        expect(() => normalizeDoubanSubjectId('tt30382501')).toThrow('Invalid Douban subject ID');
    });

    it('promotes thumbnail urls to large photo urls', () => {
        expect(promoteDoubanPhotoUrl('https://img1.doubanio.com/view/photo/m/public/p2913450214.webp')).toBe('https://img1.doubanio.com/view/photo/l/public/p2913450214.webp');
        expect(promoteDoubanPhotoUrl('https://img9.doubanio.com/view/photo/s_ratio_poster/public/p2578474613.jpg')).toBe('https://img9.doubanio.com/view/photo/l/public/p2578474613.jpg');
    });

    it('rejects non-http photo urls during promotion', () => {
        expect(promoteDoubanPhotoUrl('data:image/gif;base64,abc')).toBe('');
    });

    it('prefers lazy-loaded photo urls over data placeholders', () => {
        expect(resolveDoubanPhotoAssetUrl([
            '',
            'https://img1.doubanio.com/view/photo/m/public/p2913450214.webp',
            'data:image/gif;base64,abc',
        ], 'https://movie.douban.com/subject/30382501/photos?type=Rb')).toBe('https://img1.doubanio.com/view/photo/m/public/p2913450214.webp');
    });

    it('drops unsupported non-http photo urls when no real image url exists', () => {
        expect(resolveDoubanPhotoAssetUrl(['data:image/gif;base64,abc', 'blob:https://movie.douban.com/example'], 'https://movie.douban.com/subject/30382501/photos?type=Rb')).toBe('');
    });

    it('removes the default photo cap when scanning for an exact photo id', async () => {
        const evaluate = vi.fn()
            .mockResolvedValueOnce({ blocked: false, title: 'Some Movie', href: 'https://movie.douban.com/subject/30382501/photos?type=Rb' })
            .mockResolvedValueOnce({
            subjectId: '30382501',
            subjectTitle: 'The Wandering Earth 2',
            type: 'Rb',
            photos: [
                {
                    index: 731,
                    photoId: '2913450215',
                    title: 'Character poster',
                    imageUrl: 'https://img1.doubanio.com/view/photo/l/public/p2913450215.jpg',
                    thumbUrl: 'https://img1.doubanio.com/view/photo/m/public/p2913450215.jpg',
                    detailUrl: 'https://movie.douban.com/photos/photo/2913450215/',
                    page: 25,
                },
            ],
        });
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate,
        };
        await loadDoubanSubjectPhotos(page, '30382501', {
            type: 'Rb',
            targetPhotoId: '2913450215',
        });
        const scanScript = evaluate.mock.calls[1]?.[0];
        expect(scanScript).toContain('const targetPhotoId = "2913450215";');
        expect(scanScript).toContain(`const limit = ${Number.MAX_SAFE_INTEGER};`);
        expect(scanScript).toContain('for (let pageIndex = 0; photos.length < limit; pageIndex += 1)');
    });

    it('keeps image extensions when download urls contain query params', () => {
        expect(getDoubanPhotoExtension('https://img1.doubanio.com/view/photo/l/public/p2913450214.webp?foo=1')).toBe('.webp');
        expect(getDoubanPhotoExtension('https://img1.doubanio.com/view/photo/l/public/p2913450214.jpeg')).toBe('.jpeg');
    });

    it('maps tv series results to tvshow in searchDouban output', async () => {
        const domItems = [
            createFakeSearchItem({
                title: '射雕英雄传‎ (2017)',
                url: 'https://movie.douban.com/subject/26663086/',
                rating: '7.9',
                abstract: '中国大陆 / 剧情 / 武侠 / 古装 / 45分钟',
                cover: 'https://img1.doubanio.com/view/photo/s_ratio_poster/public/p2411844029.webp',
            }),
            createFakeSearchItem({
                title: '射雕英雄传：侠之大者‎ (2025)',
                url: 'https://movie.douban.com/subject/36289423/',
                rating: '5.2',
                abstract: '中国大陆 / 武侠 / 146分钟',
                cover: 'https://img1.doubanio.com/view/photo/s_ratio_poster/public/p2917502509.webp',
            }),
        ];
        const rawItems = [
            {
                id: 26663086,
                labels: [{ text: '剧集' }, { text: '可播放' }],
                more_url: "onclick=\"moreurl(this,{from:'mv_subject_search',subject_id:'26663086',is_tv:'1'})\"",
            },
            {
                id: 36289423,
                labels: [{ text: '可播放' }],
                more_url: "onclick=\"moreurl(this,{from:'mv_subject_search',subject_id:'36289423',is_tv:'0'})\"",
            },
        ];
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn()
                .mockResolvedValueOnce({ blocked: false, title: '射雕英雄传 - 电影 - 豆瓣搜索', href: 'https://search.douban.com/movie/subject_search?search_text=%E5%B0%84%E9%9B%95%E8%8B%B1%E9%9B%84%E4%BC%A0' })
                .mockImplementationOnce((script) => runSearchEvaluate(script, rawItems, domItems)),
        };
        await expect(searchDouban(page, 'movie', '射雕英雄传', 20)).resolves.toMatchObject([
            { id: '26663086', type: 'tvshow', title: '射雕英雄传‎ (2017)' },
            { id: '36289423', type: 'movie', title: '射雕英雄传：侠之大者‎ (2025)' },
        ]);
    });

    it('normalizes douban book subject raw data into structured fields', () => {
        const normalized = normalizeDoubanBookSubject({
            id: '2567698',
            title: '小狗钱钱',
            subtitle: '让孩子和家长共同成长的财商童话',
            originalTitle: 'Ein Hund namens Money',
            infoText: `
作者: [德] 博多·舍费尔
出版社: 南海出版公司
副标题: 让孩子和家长共同成长的财商童话
原作名: Ein Hund namens Money
译者: 王钟欣 / 余茜
出版年: 2014-1-1
页数: 208
定价: 26.00元
装帧: 平装
丛书: 新经典文库·爱心树童书
ISBN: 9787544270871
      `,
            rating: '8.9',
            ratingCount: '12345',
            summary: '理财启蒙故事',
            cover: 'https://img9.doubanio.com/view/subject/l/public/s29618581.jpg',
            url: 'https://book.douban.com/subject/2567698/',
        });
        expect(normalized).toMatchObject({
            id: '2567698',
            type: 'book',
            title: '小狗钱钱',
            subtitle: '让孩子和家长共同成长的财商童话',
            originalTitle: 'Ein Hund namens Money',
            authors: ['[德] 博多·舍费尔'],
            translators: ['王钟欣', '余茜'],
            publisher: '南海出版公司',
            publishDate: '2014-1-1',
            publishYear: '2014',
            pageCount: 208,
            binding: '平装',
            price: '26.00元',
            series: '新经典文库·爱心树童书',
            isbn13: '9787544270871',
            rating: 8.9,
            ratingCount: 12345,
            summary: '理财启蒙故事',
            cover: 'https://img9.doubanio.com/view/subject/l/public/s29618581.jpg',
            url: 'https://book.douban.com/subject/2567698/',
        });
    });

    it('parses movie-hot rows with real chart fields only', async () => {
        const items = [
            createFakeMovieHotItem({
                title: ' 少年与犬 ',
                url: '/subject/36840171/',
                info: '2025-03-20 / 日本 / 剧情',
                rating: '6.8',
                votes: '(12345人评价)',
                cover: 'https://img1.doubanio.com/view/photo/s_ratio_poster/public/p1.jpg',
            }),
        ];
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn()
                .mockResolvedValueOnce({ blocked: false, title: '豆瓣电影排行榜', href: 'https://movie.douban.com/chart' })
                .mockImplementationOnce((script) => runMovieHotEvaluate(script, items)),
        };

        await expect(loadDoubanMovieHot(page, 20)).resolves.toEqual([
            {
                rank: 1,
                id: '36840171',
                title: '少年与犬',
                rating: 6.8,
                votes: 12345,
                year: '2025',
                url: 'https://movie.douban.com/subject/36840171/',
                cover: 'https://img1.doubanio.com/view/photo/s_ratio_poster/public/p1.jpg',
            },
        ]);
    });

    it('throws EmptyResultError when movie-hot parses no chart rows', async () => {
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn()
                .mockResolvedValueOnce({ blocked: false, title: '豆瓣电影排行榜', href: 'https://movie.douban.com/chart' })
                .mockResolvedValueOnce([]),
        };

        await expect(loadDoubanMovieHot(page, 20)).rejects.toThrow('douban movie-hot returned no data');
    });

    it('loads book subject details from book.douban.com when type=book', async () => {
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn()
                .mockResolvedValueOnce({ blocked: false, title: '小狗钱钱 (豆瓣)', href: 'https://book.douban.com/subject/2567698/' })
                .mockResolvedValueOnce({
                id: '2567698',
                title: '小狗钱钱',
                subtitle: '',
                originalTitle: '',
                infoText: `
作者: [德] 博多·舍费尔
出版社: 南海出版公司
出版年: 2014-1-1
ISBN: 9787544270871
        `,
                rating: '8.9',
                ratingCount: '12345',
                summary: '理财启蒙故事',
                cover: 'https://img9.doubanio.com/view/subject/l/public/s29618581.jpg',
                url: 'https://book.douban.com/subject/2567698/',
            }),
        };
        const detail = await loadDoubanSubjectDetail(page, '2567698', 'book');
        expect(page.goto).toHaveBeenCalledWith('https://book.douban.com/subject/2567698/', {
            waitUntil: 'load',
            settleMs: 1500,
        });
        expect(page.wait).toHaveBeenCalledWith({ selector: 'h1 span, #info', timeout: 8 });
        expect(detail).toMatchObject({
            id: '2567698',
            type: 'book',
            title: '小狗钱钱',
            authors: ['[德] 博多·舍费尔'],
            publisher: '南海出版公司',
            isbn13: '9787544270871',
            rating: 8.9,
            ratingCount: 12345,
            url: 'https://book.douban.com/subject/2567698/',
        });
    });

    it('retries transient detached navigation errors when loading douban search results', async () => {
        const page = {
            goto: vi.fn()
                .mockRejectedValueOnce(new Error('Detached while handling command'))
                .mockResolvedValueOnce(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn()
                .mockResolvedValueOnce({
                blocked: false,
                title: '经济学思维 - 豆瓣搜索',
                href: 'https://search.douban.com/book/subject_search?search_text=%E7%BB%8F%E6%B5%8E%E5%AD%A6%E6%80%9D%E7%BB%B4&cat=1001',
            })
                .mockResolvedValueOnce([
                {
                    rank: 1,
                    id: '26895402',
                    type: 'book',
                    title: '经济学思维',
                    rating: 7.9,
                    abstract: '李子畅 / 中信出版社 / 2016-7',
                    url: 'https://book.douban.com/subject/26895402/',
                    cover: 'https://img1.doubanio.com/view/subject/m/public/s29000000.jpg',
                },
            ]),
        };
        const results = await searchDouban(page, 'book', '经济学思维', 3);
        expect(page.goto).toHaveBeenNthCalledWith(1, 'https://search.douban.com/book/subject_search?search_text=%E7%BB%8F%E6%B5%8E%E5%AD%A6%E6%80%9D%E7%BB%B4&cat=1001', {
            waitUntil: 'load',
            settleMs: 1500,
        });
        expect(page.goto).toHaveBeenCalledTimes(2);
        expect(page.wait).toHaveBeenCalledWith({
            selector: '.item-root .title-text, .item-root .title a, .result-list .result-item h3 a',
            timeout: 8,
        });
        expect(results).toEqual([
            {
                rank: 1,
                id: '26895402',
                type: 'book',
                title: '经济学思维',
                rating: 7.9,
                abstract: '李子畅 / 中信出版社 / 2016-7',
                url: 'https://book.douban.com/subject/26895402/',
                cover: 'https://img1.doubanio.com/view/subject/m/public/s29000000.jpg',
            },
        ]);
    });
});

describe('inferDoubanSearchResultType', () => {
    it('returns tvshow for movie search results marked as TV', () => {
        expect(inferDoubanSearchResultType('movie', {
            moreUrl: "onclick=\"moreurl(this,{is_tv:'1'})\"",
            labels: [{ text: '剧集' }],
        })).toBe('tvshow');
    });

    it('returns movie when a movie search result has no TV signal', () => {
        expect(inferDoubanSearchResultType('movie', {
            moreUrl: "onclick=\"moreurl(this,{is_tv:'0'})\"",
            labels: [{ text: '可播放' }],
        })).toBe('movie');
    });

    it('preserves non-movie search types', () => {
        expect(inferDoubanSearchResultType('book', {
            moreUrl: '',
            labels: [{ text: '图书' }],
        })).toBe('book');
    });
});
