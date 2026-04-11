import { describe, expect, it } from 'vitest';
import { buildScysTopicLink, formatScysRelativeTime, inferTopicIdFromImageUrls, normalizeOpportunityTab, parseAiSummaryText, stripScysRichText, splitOpportunityFlagsAndTags, } from './opportunity-utils.js';
describe('normalizeOpportunityTab', () => {
    it('maps all aliases', () => {
        expect(normalizeOpportunityTab('')).toEqual({ key: 'all', label: '全部' });
        expect(normalizeOpportunityTab('all')).toEqual({ key: 'all', label: '全部' });
        expect(normalizeOpportunityTab('全部')).toEqual({ key: 'all', label: '全部' });
    });
    it('maps hot aliases', () => {
        expect(normalizeOpportunityTab('hot')).toEqual({ key: 'hot', label: '热门' });
        expect(normalizeOpportunityTab('热门')).toEqual({ key: 'hot', label: '热门' });
    });
    it('maps winning aliases', () => {
        expect(normalizeOpportunityTab('winning')).toEqual({ key: 'winning', label: '中标' });
        expect(normalizeOpportunityTab('win')).toEqual({ key: 'winning', label: '中标' });
        expect(normalizeOpportunityTab('中标')).toEqual({ key: 'winning', label: '中标' });
    });
});
describe('splitOpportunityFlagsAndTags', () => {
    it('splits system flags and custom tags', () => {
        expect(splitOpportunityFlagsAndTags(['中标', '市场洞察', '垂直小号', '00后/大学生'])).toEqual({
            flags: ['中标', '市场洞察'],
            tags: ['垂直小号', '00后/大学生'],
        });
    });
});
describe('buildScysTopicLink', () => {
    it('builds canonical article detail link', () => {
        expect(buildScysTopicLink('xq_topic', '45811252552251118')).toBe('https://scys.com/articleDetail/xq_topic/45811252552251118');
    });
});
describe('inferTopicIdFromImageUrls', () => {
    it('extracts topic id from signed oss image urls', () => {
        expect(inferTopicIdFromImageUrls([
            'https://sphere-sh.oss-cn-shanghai.aliyuncs.com/private/xq/images/45811252552251118/Fmrm4.jpg?Expires=1',
        ])).toBe('45811252552251118');
    });
});
describe('parseAiSummaryText', () => {
    it('strips html tags', () => {
        expect(parseAiSummaryText('<signal-summary><p><b>细分需求：</b>测试</p></signal-summary>')).toBe('细分需求： 测试');
    });
});
describe('stripScysRichText', () => {
    it('converts SCYS hashtag marker and strips tags', () => {
        expect(stripScysRichText('蹭热度：<e type="hashtag" title="%23%E5%85%A8%E5%9B%BD%E8%AE%A1%E7%AE%97%E6%9C%BA%E8%80%83%E8%AF%95%23" /> <p>备考</p>')).toBe('蹭热度： #全国计算机考试# 备考');
    });
});
describe('formatScysRelativeTime', () => {
    const now = new Date('2026-03-28T12:00:00Z').getTime();
    it('formats recent intervals', () => {
        expect(formatScysRelativeTime(Math.floor((now - 30_000) / 1000), now)).toBe('刚刚');
        expect(formatScysRelativeTime(Math.floor((now - 10 * 60_000) / 1000), now)).toBe('10分钟前');
        expect(formatScysRelativeTime(Math.floor((now - 3 * 3600_000) / 1000), now)).toBe('3小时前');
        expect(formatScysRelativeTime(Math.floor((now - 5 * 86400_000) / 1000), now)).toBe('5天前');
    });
    it('falls back to absolute date for old timestamps', () => {
        expect(formatScysRelativeTime(Math.floor((now - 40 * 86400_000) / 1000), now)).toBe('2026-02-16');
    });
});
