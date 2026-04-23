import { describe, expect, it } from 'vitest';
import { __test__ } from './articles.js';

describe('toutiao articles parser', () => {
    it('keeps short chinese titles instead of silently dropping the row', () => {
        const text = [
            '短标题',
            '04-20 20:30',
            '已发布',
            '展现 8 阅读 0 点赞 0 评论 0',
        ].join('\n');

        expect(__test__.parseToutiaoArticlesText(text)).toEqual([{
            title: '短标题',
            date: '04-20 20:30',
            status: '已发布',
            '展现': '8',
            '阅读': '0',
            '点赞': '0',
            '评论': '0',
        }]);
    });
});
