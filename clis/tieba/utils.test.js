import { describe, expect, it } from 'vitest';
import { MAX_TIEBA_LIMIT, buildTiebaPostCardsFromPagePc, buildTiebaPostItems, buildTiebaSearchItems, buildTiebaReadItems, normalizeTiebaLimit, signTiebaPcParams, } from './utils.js';
describe('normalizeTiebaLimit', () => {
    it('caps list commands at the declared tieba maximum', () => {
        expect(MAX_TIEBA_LIMIT).toBe(20);
        expect(normalizeTiebaLimit(undefined)).toBe(20);
        expect(normalizeTiebaLimit(25)).toBe(20);
        expect(normalizeTiebaLimit(7)).toBe(7);
    });
});
describe('signTiebaPcParams', () => {
    it('matches Tieba PC forum-list signing for stable page_pc requests', () => {
        expect(signTiebaPcParams({
            kw: encodeURIComponent('李毅'),
            pn: '1',
            sort_type: '-1',
            is_newfrs: '1',
            is_newfeed: '1',
            rn: '30',
            rn_need: '20',
            tbs: '',
            subapp_type: 'pc',
            _client_type: '20',
        })).toBe('466f2e091dd4ed17c6661a842b5ec342');
    });
});
describe('buildTiebaPostCardsFromPagePc', () => {
    it('extracts thread cards from signed page_pc feed payloads', () => {
        const cards = buildTiebaPostCardsFromPagePc([
            {
                layout: 'feed',
                feed: {
                    schema: 'tiebaapp://router/portal?params=%7B%22pageParams%22%3A%7B%22tid%22%3A10596901456%7D%7D',
                    log_param: [
                        { key: 'tid', value: '10596901456' },
                    ],
                    business_info_map: {
                        thread_id: '10596901456',
                        title: '崇拜希特勒的人都是日本的汉奸走狗',
                    },
                    components: [
                        {
                            component: 'feed_head',
                            feed_head: {
                                extra_data: [
                                    {
                                        business_info_map: { time_prefix: '回复于' },
                                        text: { text: '1774343231' },
                                    },
                                ],
                                main_data: [
                                    {
                                        text: { text: '上帝的子民º♬' },
                                    },
                                ],
                            },
                        },
                        {
                            component: 'feed_title',
                            feed_title: {
                                data: [{ text_info: { text: '崇拜希特勒的人都是日本的汉奸走狗' } }],
                            },
                        },
                        {
                            component: 'feed_social',
                            feed_social: {
                                comment_num: 12,
                            },
                        },
                    ],
                },
            },
        ]);
        expect(cards).toEqual([
            {
                title: '崇拜希特勒的人都是日本的汉奸走狗',
                author: '上帝的子民º♬',
                descInfo: '回复于2026-03-24 17:07',
                commentCount: 12,
                actionTexts: [],
                threadId: '10596901456',
                url: 'https://tieba.baidu.com/p/10596901456',
            },
        ]);
    });
});
describe('buildTiebaPostItems', () => {
    it('builds stable thread ids and urls from card props without page hops', () => {
        const items = buildTiebaPostItems([
            {
                title: '我来说个事',
                author: '暴躁的小伙子',
                descInfo: '回复于2分钟前',
                actionTexts: ['分享', '评论 5', '点赞 2'],
                threadId: '10590564788',
            },
        ], 5);
        expect(items).toEqual([
            {
                rank: 1,
                title: '我来说个事',
                author: '暴躁的小伙子',
                replies: 5,
                last_reply: '2分钟前',
                id: '10590564788',
                url: 'https://tieba.baidu.com/p/10590564788',
            },
        ]);
    });
    it('honors the public 20-item limit contract', () => {
        const raw = Array.from({ length: 25 }, (_, index) => ({
            title: `帖子 ${index + 1}`,
            author: `作者 ${index + 1}`,
            descInfo: '回复于刚刚',
            actionTexts: ['分享', `评论 ${index + 1}`],
            threadId: String(1000 + index),
        }));
        const items = buildTiebaPostItems(raw, 25);
        expect(items).toHaveLength(20);
        expect(items[19]).toMatchObject({
            rank: 20,
            id: '1019',
            url: 'https://tieba.baidu.com/p/1019',
        });
    });
    it('parses Chinese count units and keeps date-time last-reply text intact', () => {
        const items = buildTiebaPostItems([
            {
                title: '复杂格式帖子',
                author: '作者',
                descInfo: '回复于03-29 11:35',
                actionTexts: ['分享', '评论 1.2万'],
                url: 'https://tieba.baidu.com/p/123456',
            },
        ], 5);
        expect(items[0]).toMatchObject({
            replies: 12000,
            last_reply: '03-29 11:35',
            id: '123456',
            url: 'https://tieba.baidu.com/p/123456',
        });
    });
});
describe('buildTiebaSearchItems', () => {
    it('keeps up to 20 search results when the page provides more than 10 cards', () => {
        const raw = Array.from({ length: 25 }, (_, index) => ({
            title: `结果 ${index + 1}`,
            forum: '编程吧',
            author: `作者 ${index + 1}`,
            time: '2026-03-29',
            snippet: `摘要 ${index + 1}`,
            id: String(2000 + index),
            url: `https://tieba.baidu.com/p/${2000 + index}`,
        }));
        const items = buildTiebaSearchItems(raw, 25);
        expect(items).toHaveLength(20);
        expect(items[19]).toMatchObject({
            rank: 20,
            id: '2019',
            url: 'https://tieba.baidu.com/p/2019',
        });
    });
    it('fills missing search ids from stable thread urls', () => {
        const items = buildTiebaSearchItems([
            {
                title: '搜索结果',
                forum: '编程吧',
                author: '作者',
                time: '2026-03-29 11:35',
                snippet: '摘要',
                id: '',
                url: 'https://tieba.baidu.com/p/654321',
            },
        ], 5);
        expect(items[0]).toMatchObject({
            id: '654321',
            url: 'https://tieba.baidu.com/p/654321',
        });
    });
});
describe('buildTiebaReadItems', () => {
    it('prefers visible main-post fields and still keeps floor 1 for media-only threads', () => {
        const items = buildTiebaReadItems({
            mainPost: {
                title: '刚开始读博士的人据说都这样',
                author: '湖水之岸',
                contentText: '',
                structuredText: '',
                visibleTime: '03-24',
                structuredTime: 1774343231,
                hasMedia: true,
            },
            replies: [],
        }, { limit: 5, includeMainPost: true });
        expect(items).toEqual([
            {
                floor: 1,
                author: '湖水之岸',
                content: '刚开始读博士的人据说都这样 [media]',
                time: '03-24',
            },
        ]);
    });
    it('falls back to structured main-post data when visible text is missing', () => {
        const items = buildTiebaReadItems({
            mainPost: {
                title: '标题',
                author: '',
                fallbackAuthor: '结构化作者',
                contentText: '',
                structuredText: '结构化正文',
                visibleTime: '',
                structuredTime: 1774343231,
                hasMedia: false,
            },
            replies: [
                { floor: 2, author: '回复者', content: '二楼内容', time: '第2楼 2026-03-25 12:34 广东' },
            ],
        }, { limit: 5, includeMainPost: true });
        expect(items[0]).toMatchObject({
            floor: 1,
            author: '结构化作者',
            content: '标题 结构化正文',
            time: '2026-03-24 17:07',
        });
        expect(items[1]).toMatchObject({
            floor: 2,
            author: '回复者',
            content: '二楼内容',
            time: '2026-03-25 12:34',
        });
    });
    it('strips trailing location metadata from reply times', () => {
        const items = buildTiebaReadItems({
            mainPost: {
                title: '主楼',
                author: '楼主',
                contentText: '正文',
                visibleTime: '03-24',
            },
            replies: [
                { floor: 2, author: '二楼', content: '二楼内容', time: '第2楼 3小时前 福建' },
                { floor: 3, author: '三楼', content: '三楼内容', time: '第3楼 刚刚 江苏' },
            ],
        }, { limit: 5, includeMainPost: false });
        expect(items).toEqual([
            {
                floor: 2,
                author: '二楼',
                content: '二楼内容',
                time: '3小时前',
            },
            {
                floor: 3,
                author: '三楼',
                content: '三楼内容',
                time: '刚刚',
            },
        ]);
    });
    it('counts limit as replies and skips main post on later pages', () => {
        const items = buildTiebaReadItems({
            mainPost: {
                title: '主楼',
                author: '楼主',
                contentText: '正文',
                visibleTime: '03-24',
            },
            replies: [
                { floor: 2, author: '二楼', content: '二楼内容', time: '第2楼 03-25' },
                { floor: 3, author: '三楼', content: '三楼内容', time: '第3楼 03-26' },
                { floor: 4, author: '四楼', content: '四楼内容', time: '第4楼 03-27' },
            ],
        }, { limit: 2, includeMainPost: true });
        expect(items).toHaveLength(3);
        expect(items.map((item) => item.floor)).toEqual([1, 2, 3]);
        const page2 = buildTiebaReadItems({
            mainPost: {
                title: '主楼',
                author: '楼主',
                contentText: '正文',
                visibleTime: '03-24',
            },
            replies: [
                { floor: 26, author: '二十六楼', content: '二十六楼内容', time: '第26楼 03-29' },
            ],
        }, { limit: 2, includeMainPost: false });
        expect(page2.map((item) => item.floor)).toEqual([26]);
    });
});
