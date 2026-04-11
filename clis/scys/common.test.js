import { describe, expect, it } from 'vitest';
import { cleanText, detectScysPageType, extractScysArticleMeta, extractInteractions, normalizeScysUrl, toScysArticleUrl, toScysCourseUrl, } from './common.js';
describe('normalizeScysUrl', () => {
    it('normalizes bare domain and keeps path/query', () => {
        expect(normalizeScysUrl('scys.com/course/detail/142?chapterId=9445')).toBe('https://scys.com/course/detail/142?chapterId=9445');
    });
    it('normalizes root-relative paths', () => {
        expect(normalizeScysUrl('/opportunity')).toBe('https://scys.com/opportunity');
    });
});
describe('toScysCourseUrl', () => {
    it('accepts numeric course id', () => {
        expect(toScysCourseUrl('92')).toBe('https://scys.com/course/detail/92');
    });
    it('keeps full course detail URL unchanged', () => {
        expect(toScysCourseUrl('https://scys.com/course/detail/142?chapterId=9445')).toBe('https://scys.com/course/detail/142?chapterId=9445');
    });
});
describe('toScysArticleUrl', () => {
    it('accepts numeric topic id', () => {
        expect(toScysArticleUrl('55188458224514554')).toBe('https://scys.com/articleDetail/xq_topic/55188458224514554');
    });
    it('keeps full article detail url', () => {
        expect(toScysArticleUrl('https://scys.com/articleDetail/xq_topic/55188458224514554')).toBe('https://scys.com/articleDetail/xq_topic/55188458224514554');
    });
});
describe('extractScysArticleMeta', () => {
    it('extracts entity type and topic id from url', () => {
        expect(extractScysArticleMeta('https://scys.com/articleDetail/xq_topic/55188458224514554')).toEqual({
            entityType: 'xq_topic',
            topicId: '55188458224514554',
        });
    });
});
describe('detectScysPageType', () => {
    it('detects course detail with chapterId', () => {
        expect(detectScysPageType('https://scys.com/course/detail/142?chapterId=9445')).toBe('course');
    });
    it('detects course detail without chapterId', () => {
        expect(detectScysPageType('https://scys.com/course/detail/92')).toBe('course');
    });
    it('detects essence feed on homepage', () => {
        expect(detectScysPageType('https://scys.com/?filter=essence')).toBe('feed');
    });
    it('detects profile posts feed', () => {
        expect(detectScysPageType('https://scys.com/personal/421122582111848?number=18563&tab=posts')).toBe('feed');
    });
    it('detects opportunity page', () => {
        expect(detectScysPageType('https://scys.com/opportunity')).toBe('opportunity');
    });
    it('detects activity landing page', () => {
        expect(detectScysPageType('https://scys.com/activity/landing/5505?tabIndex=1')).toBe('activity');
    });
    it('detects article detail page', () => {
        expect(detectScysPageType('https://scys.com/articleDetail/xq_topic/55188458224514554')).toBe('article');
    });
    it('returns unknown for unsupported pages', () => {
        expect(detectScysPageType('https://scys.com/help')).toBe('unknown');
    });
});
describe('text helpers', () => {
    it('cleanText collapses whitespace', () => {
        expect(cleanText('  hello\n\nworld  ')).toBe('hello world');
    });
    it('extractInteractions keeps compact numeric text', () => {
        expect(extractInteractions('赞 1.2万 评论 35')).toBe('1.2万 35');
    });
});
