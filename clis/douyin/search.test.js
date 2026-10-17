import { describe, expect, it } from 'vitest';

import {
    extractDouyinVideoId,
    MAX_SEARCH_LIMIT,
    normalizeDouyinVideoUrl,
    parseDouyinCount,
    parseSearchLimit,
    projectCard,
    projectSearchCards,
} from './search.js';

describe('douyin search', () => {
    it('rejects limit above MAX_SEARCH_LIMIT', () => {
        expect(() => parseSearchLimit(MAX_SEARCH_LIMIT + 1)).toThrow(/--limit/);
    });

});

describe('parseDouyinCount', () => {
    it.each([
        ['1.9万', 19_000],
        ['3万', 30_000],
        ['4702', 4702],
        ['1,234', 1234],
        ['1.2亿', 120_000_000],
        ['', 0],
        ['unknown', 0],
        [null, 0],
        [undefined, 0],
    ])('parses %j as %i', (input, expected) => {
        expect(parseDouyinCount(input)).toBe(expected);
    });
});

describe('normalizeDouyinVideoUrl', () => {
    it.each([
        ['//www.douyin.com/video/123', 'https://www.douyin.com/video/123'],
        ['/video/123?foo=bar', 'https://www.douyin.com/video/123'],
        ['https://www.douyin.com/video/123?something', 'https://www.douyin.com/video/123'],
        ['https://evil.test/video/123', ''],
        ['https://www.douyin.com/user/video/123', ''],
        ['', ''],
        [null, ''],
    ])('normalizes %j → %j', (input, expected) => {
        expect(normalizeDouyinVideoUrl(input)).toBe(expected);
    });

    it('extracts only stable Douyin video ids', () => {
        expect(extractDouyinVideoId('https://www.douyin.com/video/123')).toBe('123');
        expect(extractDouyinVideoId('//www.douyin.com/video/456')).toBe('456');
        expect(extractDouyinVideoId('https://evil.test/video/123')).toBe('');
    });
});

describe('projectCard', () => {
    it('extracts duration/likes/desc/author by leaf-text shape, classname-agnostic', () => {
        const row = projectCard({
            url: '//www.douyin.com/video/7585120459717365001',
            leafTexts: ['合集', '03:55', '1.9万', 'Python邪修', '@', '校长', '5月前'],
        }, 0);
        expect(row).toEqual({
            rank: 1,
            desc: 'Python邪修',
            author: '校长',
            url: 'https://www.douyin.com/video/7585120459717365001',
            plays: 0,
            likes: 19000,
            comments: 0,
            shares: 0,
        });
    });

    it('returns the longest non-skipped text as desc, not the publish-date suffix', () => {
        const row = projectCard({
            url: '/video/1',
            leafTexts: ['02:00', '4702', 'hi long-text', '@', 'user', '1月前'],
        }, 0);
        expect(row.desc).toBe('hi long-text');
        expect(row.author).toBe('user');
    });

    it('strips a fused @author prefix from the desc when present', () => {
        const row = projectCard({
            url: '/video/1',
            leafTexts: ['02:00', '100', '@alice this is the caption', '@', 'alice'],
        }, 0);
        expect(row.author).toBe('alice');
        expect(row.desc).toBe('this is the caption');
    });

    it('returns safe defaults when leafTexts is missing', () => {
        const row = projectCard({ url: '/video/42', leafTexts: undefined }, 4);
        expect(row).toEqual({
            rank: 5,
            desc: '',
            author: '',
            url: 'https://www.douyin.com/video/42',
            plays: 0,
            likes: 0,
            comments: 0,
            shares: 0,
        });
    });

    it('returns rank=index+1 regardless of input', () => {
        const row = projectCard({ url: '/video/1', leafTexts: ['x'] }, 9);
        expect(row.rank).toBe(10);
    });

    it('projects cards and reports malformed rows in the returned window', () => {
        const result = projectSearchCards([
            { url: '/video/1', leafTexts: ['caption'] },
            { url: '/video/not-numeric', leafTexts: ['bad'] },
            { url: '/video/3', leafTexts: [] },
        ], 3);
        expect(result.rows).toHaveLength(1);
        expect(result.invalidCount).toBe(2);
    });

    it('does not treat metadata-only leaf text as a stable desc', () => {
        const result = projectSearchCards([
            { url: '/video/1', leafTexts: ['合集', '03:55', '1.9万', '@', '校长', '5月前'] },
        ], 1);
        expect(result.rows).toHaveLength(0);
        expect(result.invalidCount).toBe(1);
    });
});
