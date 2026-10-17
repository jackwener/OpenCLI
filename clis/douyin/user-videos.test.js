import { beforeEach, describe, expect, it, vi } from 'vitest';
const { fetchDouyinUserVideosMock, fetchDouyinCommentsMock } = vi.hoisted(() => ({
    fetchDouyinUserVideosMock: vi.fn(),
    fetchDouyinCommentsMock: vi.fn(),
}));
vi.mock('./_shared/public-api.js', () => ({
    fetchDouyinUserVideos: fetchDouyinUserVideosMock,
    fetchDouyinComments: fetchDouyinCommentsMock,
}));

import { ArgumentError } from '@jackwener/opencli/errors';
import { DEFAULT_COMMENT_LIMIT, MAX_USER_VIDEOS_LIMIT, normalizeCommentLimit, normalizeSecUid, normalizeUserVideosLimit } from './user-videos.js';
describe('douyin user-videos', () => {
    beforeEach(() => {
        fetchDouyinUserVideosMock.mockReset();
        fetchDouyinCommentsMock.mockReset();
    });

    it('accepts a bare sec_uid and a pasted profile URL', () => {
        expect(normalizeSecUid('MS4wLjABAAAA_example-01')).toBe('MS4wLjABAAAA_example-01');
        expect(normalizeSecUid('  MS4wLjABAAAA_example-01  ')).toBe('MS4wLjABAAAA_example-01');
        expect(normalizeSecUid('https://www.douyin.com/user/MS4wLjABAAAA_example-01?from=x')).toBe('MS4wLjABAAAA_example-01');
    });
    it('rejects a nickname instead of silently scraping another account', () => {
        expect(() => normalizeSecUid('大圆镜科普')).toThrow(ArgumentError);
        expect(() => normalizeSecUid('some user')).toThrow(ArgumentError);
        expect(() => normalizeSecUid('creatorname')).toThrow(ArgumentError);
        expect(() => normalizeSecUid('12345678901234567890')).toThrow(ArgumentError);
        expect(() => normalizeSecUid('')).toThrow(ArgumentError);
    });

    it('clamps limit to a safe maximum', () => {
        expect(normalizeUserVideosLimit(100)).toBe(MAX_USER_VIDEOS_LIMIT);
        expect(normalizeUserVideosLimit(0)).toBe(1);
        expect(normalizeCommentLimit(99)).toBe(DEFAULT_COMMENT_LIMIT);
    });

});
