import { describe, expect, it } from 'vitest';
import { parseNoteId } from './note-helpers.js';

describe('parseNoteId', () => {
    it('extracts note ID from standard explore URL', () => {
        expect(parseNoteId('https://www.xiaohongshu.com/explore/abc123def456')).toBe('abc123def456');
    });

    it('extracts note ID from note URL', () => {
        expect(parseNoteId('https://www.xiaohongshu.com/note/abc123def456')).toBe('abc123def456');
    });

    it('extracts note ID from user profile URL', () => {
        expect(parseNoteId('https://www.xiaohongshu.com/user/profile/username/abc123def456')).toBe('abc123def456');
    });

    it('extracts note ID from creator center URL', () => {
        expect(parseNoteId('https://creator.xiaohongshu.com/statistics/note-detail?noteId=abc123def456')).toBe('abc123def456');
    });

    it('returns bare note ID unchanged', () => {
        expect(parseNoteId('abc123def456')).toBe('abc123def456');
    });

    it('handles creator URL with additional query params', () => {
        expect(parseNoteId('https://creator.xiaohongshu.com/statistics/note-detail?noteId=abc123&tab=1')).toBe('abc123');
    });
});
