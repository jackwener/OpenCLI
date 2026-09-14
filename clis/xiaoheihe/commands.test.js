import { describe, expect, it, vi } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { Strategy, getRegistry } from '@jackwener/opencli/registry';
import './feed.js';
import './hot.js';
import './post.js';
import './topics.js';
import {
    collectHotPostsFromNuxt,
    collectPostDetailFromNuxt,
    collectPostLinksFromNuxt,
    collectTopicsFromNuxt,
    normalizeLimit,
    normalizePostId,
    toPostUrl,
} from './utils.js';

const POST_ID = '184169654';

function createNuxtState() {
    return {
        data: {
            home: {
                result: {
                    links: [
                        {
                            linkid: 184169654,
                            title: '被误封了怎么办！',
                            description: 'pcie插了一张远程开机卡，给我监测封号了！',
                            user: { username: 'ChMYGOD' },
                            topics: [{ topic_id: 7216, name: '绝地求生', hot_value_v2: 99, pic_url: 'https://img/topic.png' }],
                            link_award_num: 226,
                            comment_num: 498,
                            create_at: 1782291622,
                        },
                        {
                            linkid: 184341239,
                            title: 'steam大促',
                            description: '太真实了哈哈哈哈哈',
                            user: { username: 'YeMo530' },
                            topics: [{ topic_id: 1, name: 'Steam', hot_value_v2: 88, pic_url: 'https://img/steam.png' }],
                            link_award_num: 1532,
                            comment_num: 248,
                            create_at: 1782469454,
                        },
                    ],
                    subscribed_topics: [
                        { topic_id: 7214, name: '盒友杂谈', hot_value_v2: 10, pic_url: 'https://img/topic1.png' },
                    ],
                    top_topics: [
                        { topic_id: 1, name: 'PC游戏', hot_value_v2: 20, pic_url: 'https://img/topic2.png' },
                    ],
                },
            },
            detail: {
                result: {
                    link: {
                        linkid: 184169654,
                        title: '被误封了怎么办！',
                        description: 'fallback text',
                        text: JSON.stringify([
                            { type: 'text', text: 'pcie插了一张远程开机卡，给我监测封号了！' },
                            { type: 'img', url: 'https://imgheybox.example/main.jpg' },
                        ]),
                        user: { username: 'ChMYGOD' },
                        topics: [{ topic_id: 7216, name: '绝地求生' }],
                        link_award_num: 226,
                        comment_num: 498,
                        create_at: 1782291622,
                        ip_location: '山东',
                    },
                    comments: [
                        {
                            comment: [
                                {
                                    commentid: 895928162,
                                    text: '购买记录',
                                    imgs: [{ url: 'https://imgheybox.example/comment.jpg' }],
                                    user: { username: 'ChMYGOD' },
                                    up: 81,
                                    child_num: 23,
                                    create_at: 1782296452,
                                    ip_location: '山东',
                                },
                                {
                                    commentid: 895931573,
                                    replyid: 895928162,
                                    text: '上哪淘的订单截图',
                                    user: { username: '神奇海螺' },
                                    replyuser: { username: 'ChMYGOD' },
                                    up: 0,
                                    child_num: 0,
                                    create_at: 1782296746,
                                    ip_location: '广东',
                                },
                            ],
                        },
                    ],
                },
            },
        },
    };
}

describe('xiaoheihe registration', () => {
    it('registers the public browser commands', () => {
        for (const name of ['feed', 'hot', 'topics', 'post']) {
            const command = getRegistry().get(`xiaoheihe/${name}`);
            expect(command).toBeDefined();
            expect(command?.strategy).toBe(Strategy.PUBLIC);
            expect(command?.browser).toBe(true);
            expect(typeof command?.func).toBe('function');
        }
    });

    it('keeps detail row shape at the adapter maximum of 12 columns', () => {
        const command = getRegistry().get('xiaoheihe/post');
        expect(command?.columns).toHaveLength(12);
        expect(command?.columns).toEqual([
            'type',
            'id',
            'parentId',
            'author',
            'replyTo',
            'title',
            'content',
            'likes',
            'replyCount',
            'createdAt',
            'ipLocation',
            'url',
        ]);
    });
});

describe('xiaoheihe argument helpers', () => {
    it('validates limit without silent clamping', () => {
        expect(normalizeLimit(undefined, 20, 50)).toBe(20);
        expect(normalizeLimit('2', 20, 50)).toBe(2);
        expect(() => normalizeLimit(0, 20, 50)).toThrow(ArgumentError);
        expect(() => normalizeLimit(51, 20, 50)).toThrow(ArgumentError);
        expect(() => normalizeLimit('1.5', 20, 50)).toThrow(ArgumentError);
    });

    it('accepts bare ids and canonical post URLs', () => {
        expect(normalizePostId(POST_ID)).toBe(POST_ID);
        expect(normalizePostId(`https://www.xiaoheihe.cn/app/bbs/link/${POST_ID}`)).toBe(POST_ID);
        expect(toPostUrl(POST_ID)).toBe(`https://www.xiaoheihe.cn/app/bbs/link/${POST_ID}`);
        expect(() => normalizePostId('https://example.com/post/1')).toThrow(ArgumentError);
    });
});

describe('xiaoheihe Nuxt state extractors', () => {
    it('extracts feed rows with stable id/url fields', () => {
        const rows = collectPostLinksFromNuxt(createNuxtState(), 2);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({
            rank: 1,
            id: POST_ID,
            title: '被误封了怎么办！',
            author: 'ChMYGOD',
            topic: '绝地求生',
            likes: 226,
            commentCount: 498,
            createdAt: '2026-06-24T09:00:22.000Z',
            url: `https://www.xiaoheihe.cn/app/bbs/link/${POST_ID}`,
        });
    });

    it('sorts hot rows by the same interaction score used by the adapter', () => {
        const rows = collectHotPostsFromNuxt(createNuxtState(), 2);
        expect(rows.map((row) => row.id)).toEqual(['184341239', POST_ID]);
        expect(rows[0].rank).toBe(1);
    });

    it('extracts topics and deduplicates by id/name', () => {
        const rows = collectTopicsFromNuxt(createNuxtState(), 10);
        expect(rows).toEqual([
            {
                rank: 1,
                id: '1',
                name: 'Steam',
                hotValue: 88,
                icon: 'https://img/steam.png',
                url: 'https://www.xiaoheihe.cn/app/bbs/topic/1',
            },
            {
                rank: 2,
                id: '1',
                name: 'PC游戏',
                hotValue: 20,
                icon: 'https://img/topic2.png',
                url: 'https://www.xiaoheihe.cn/app/bbs/topic/1',
            },
            {
                rank: 3,
                id: '7216',
                name: '绝地求生',
                hotValue: 99,
                icon: 'https://img/topic.png',
                url: 'https://www.xiaoheihe.cn/app/bbs/topic/7216',
            },
            {
                rank: 4,
                id: '7214',
                name: '盒友杂谈',
                hotValue: 10,
                icon: 'https://img/topic1.png',
                url: 'https://www.xiaoheihe.cn/app/bbs/topic/7214',
            },
        ].sort((a, b) => b.hotValue - a.hotValue).map((row, index) => ({ ...row, rank: index + 1 })));
    });

    it('extracts the main post plus nested comments from detail Nuxt state', () => {
        const rows = collectPostDetailFromNuxt(createNuxtState(), POST_ID, { limit: 2, includeComments: true });
        expect(rows).toHaveLength(3);
        expect(rows[0]).toMatchObject({
            type: 'post',
            id: POST_ID,
            author: 'ChMYGOD',
            title: '被误封了怎么办！',
            content: expect.stringContaining('[绝地求生] pcie插了一张远程开机卡'),
            replyCount: 498,
            ipLocation: '山东',
        });
        expect(rows[1]).toMatchObject({
            type: 'comment',
            id: '895928162',
            parentId: null,
            content: expect.stringContaining('购买记录'),
            replyCount: 23,
        });
        expect(rows[2]).toMatchObject({
            type: 'comment',
            id: '895931573',
            parentId: '895928162',
            replyTo: 'ChMYGOD',
        });
    });

    it('can return only the main post', () => {
        const rows = collectPostDetailFromNuxt(createNuxtState(), POST_ID, { limit: 2, includeComments: false });
        expect(rows).toHaveLength(1);
        expect(rows[0].type).toBe('post');
    });
});

describe('xiaoheihe command wiring', () => {
    it('rejects invalid post ids before browser navigation', async () => {
        const command = getRegistry().get('xiaoheihe/post');
        const page = {
            goto: vi.fn(),
            evaluate: vi.fn(),
        };
        await expect(command.func(page, { post: 'bad-id', limit: 3 })).rejects.toMatchObject({ code: 'ARGUMENT' });
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });
});
