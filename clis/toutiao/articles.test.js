import { describe, expect, it } from 'vitest';
import { __test__ } from './articles.js';

describe('toutiao articles parser', () => {
    const articleText = [
        '短标题',
        '04-20 20:30',
        '已发布',
        '展现 8 阅读 0 点赞 0 评论 0',
    ].join('\n');
    const parsedArticle = {
        title: '短标题',
        date: '04-20 20:30',
        status: '已发布',
        '展现': '8',
        '阅读': '0',
        '点赞': '0',
        '评论': '0',
    };

    it('keeps short chinese titles instead of silently dropping the row', () => {
        expect(__test__.parseToutiaoArticlesText(articleText)).toEqual([parsedArticle]);
    });

    it('keeps parsing when serialized into the browser evaluate context', () => {
        const parse = Function(`return (${__test__.parseToutiaoArticlesText.toString()})`)();

        expect(parse(articleText)).toEqual([parsedArticle]);
    });
});
