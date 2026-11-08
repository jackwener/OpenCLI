import { describe, expect, it } from 'vitest';
import { buildEpisodeUrl, isAuthFailure, normalizeEpisodeStatus } from './upload-status.js';

describe('xiaoyuzhou upload-status', () => {
    it('buildEpisodeUrl points at the public episode page', () => {
        expect(buildEpisodeUrl('6aeec8275b7c4709bfe264de')).toBe('https://www.xiaoyuzhoufm.com/episode/6aeec8275b7c4709bfe264de');
    });

    it('isAuthFailure detects the podcaster 401/403 shape', () => {
        expect(isAuthFailure({ code: 401 })).toBe(true);
        expect(isAuthFailure({ code: 403 })).toBe(true);
        expect(isAuthFailure({ code: 200 })).toBe(false);
        expect(isAuthFailure(undefined)).toBe(false);
    });

    it('normalizeEpisodeStatus reports reviewing while the platform review is pending', () => {
        expect(normalizeEpisodeStatus({ status: 'NORMAL', reviewStatus: 'PENDING' })).toBe('reviewing');
    });

    it('normalizeEpisodeStatus reports published once the review is approved', () => {
        expect(normalizeEpisodeStatus({ status: 'NORMAL', reviewStatus: 'APPROVED' })).toBe('published');
    });

    it('normalizeEpisodeStatus keeps never-published episodes as drafts', () => {
        expect(normalizeEpisodeStatus({ status: 'NORMAL', reviewStatus: 'APPROVED', hasNeverPublished: true })).toBe('draft');
    });

    it('normalizeEpisodeStatus reports removed and rejected episodes', () => {
        expect(normalizeEpisodeStatus({ status: 'REMOVED' })).toBe('removed');
        expect(normalizeEpisodeStatus({ status: 'DELETED' })).toBe('removed');
        expect(normalizeEpisodeStatus({ status: 'NORMAL', reviewStatus: 'REJECTED' })).toBe('rejected');
    });
});
