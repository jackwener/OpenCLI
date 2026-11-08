import { describe, expect, it } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import {
    buildCreateUrl,
    buildEpisodeUrl,
    inferMimeType,
    isAuthFailure,
    normalizeEpisodeStatus,
    requirePositiveInt,
} from './upload.js';

const AUDIO_MIME_BY_EXT = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/x-m4a',
};
const IMAGE_MIME_BY_EXT = {
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
};

describe('xiaoyuzhou upload', () => {
    it('inferMimeType resolves the extension case-insensitively', () => {
        expect(inferMimeType('/tmp/episode.MP3', AUDIO_MIME_BY_EXT, 'application/octet-stream')).toBe('audio/mpeg');
        expect(inferMimeType('/tmp/cover.PNG', IMAGE_MIME_BY_EXT, 'application/octet-stream')).toBe('image/png');
    });

    it('inferMimeType falls back for unknown extensions', () => {
        expect(inferMimeType('/tmp/episode.xyz', AUDIO_MIME_BY_EXT, 'application/octet-stream')).toBe('application/octet-stream');
    });

    it('requirePositiveInt falls back for empty values and rejects non-positive input', () => {
        expect(requirePositiveInt(undefined, 'timeout', 300)).toBe(300);
        expect(requirePositiveInt('', 'timeout', 300)).toBe(300);
        expect(requirePositiveInt('60', 'timeout', 300)).toBe(60);
        expect(() => requirePositiveInt(0, 'timeout', 300)).toThrow(ArgumentError);
        expect(() => requirePositiveInt('abc', 'timeout', 300)).toThrow(ArgumentError);
    });

    it('buildCreateUrl points at the podcaster create page', () => {
        expect(buildCreateUrl('abc123')).toBe('https://podcaster.xiaoyuzhoufm.com/podcast/abc123/episode/create');
    });

    it('buildEpisodeUrl points at the public episode page', () => {
        expect(buildEpisodeUrl('6aeec8275b7c4709bfe264de')).toBe('https://www.xiaoyuzhoufm.com/episode/6aeec8275b7c4709bfe264de');
    });

    it('isAuthFailure detects the podcaster 401/403 shape', () => {
        expect(isAuthFailure({ code: 401 })).toBe(true);
        expect(isAuthFailure({ code: 403 })).toBe(true);
        expect(isAuthFailure({ code: 500 })).toBe(false);
        expect(isAuthFailure(null)).toBe(false);
        expect(isAuthFailure('nope')).toBe(false);
    });

    it('normalizeEpisodeStatus maps the raw episode status onto the public states', () => {
        expect(normalizeEpisodeStatus({ status: 'NORMAL', reviewStatus: 'APPROVED' })).toBe('published');
        expect(normalizeEpisodeStatus({ status: 'NORMAL', reviewStatus: 'PENDING' })).toBe('reviewing');
        expect(normalizeEpisodeStatus({ status: 'NORMAL', reviewStatus: 'REJECTED' })).toBe('rejected');
        expect(normalizeEpisodeStatus({ status: 'REMOVED' })).toBe('removed');
        expect(normalizeEpisodeStatus({ status: 'DELETED' })).toBe('removed');
    });

    it('normalizeEpisodeStatus keeps never-published episodes as drafts', () => {
        expect(normalizeEpisodeStatus({ status: 'NORMAL', reviewStatus: 'APPROVED', hasNeverPublished: true })).toBe('draft');
        expect(normalizeEpisodeStatus({ status: 'NORMAL', reviewStatus: 'PENDING', hasNeverPublished: 'true' })).toBe('draft');
    });

    it('normalizeEpisodeStatus treats a rejected review as rejected even for drafts', () => {
        expect(normalizeEpisodeStatus({ status: 'INITIALIZED', reviewStatus: 'REJECTED' })).toBe('rejected');
    });
});
