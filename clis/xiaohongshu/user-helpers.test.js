import { describe, expect, it } from 'vitest';
import { buildXhsNoteUrl, extractXhsUserNotes, flattenXhsNoteGroups, normalizeXhsUserId, } from './user-helpers.js';
describe('normalizeXhsUserId', () => {
    it('extracts the profile id from a full Xiaohongshu URL', () => {
        expect(normalizeXhsUserId('https://www.xiaohongshu.com/user/profile/615529370000000002026001?xsec_source=pc_search')).toBe('615529370000000002026001');
    });
    it('keeps a bare profile id unchanged', () => {
        expect(normalizeXhsUserId('615529370000000002026001')).toBe('615529370000000002026001');
    });
});
describe('flattenXhsNoteGroups', () => {
    it('flattens grouped note arrays and ignores empty groups', () => {
        expect(flattenXhsNoteGroups([[{ id: 'a' }], [], null, [{ id: 'b' }]])).toEqual([
            { id: 'a' },
            { id: 'b' },
        ]);
    });
});
describe('buildXhsNoteUrl', () => {
    it('includes xsec token when available', () => {
        expect(buildXhsNoteUrl('user123', 'note456', 'token789')).toBe('https://www.xiaohongshu.com/user/profile/user123/note456?xsec_token=token789&xsec_source=pc_user');
    });
});
describe('extractXhsUserNotes', () => {
    it('normalizes grouped note cards into CLI rows', () => {
        const rows = extractXhsUserNotes({
            noteGroups: [
                [
                    {
                        id: 'note-1',
                        xsecToken: 'abc',
                        noteCard: {
                            noteId: 'note-1',
                            displayTitle: 'First note',
                            type: 'video',
                            interactInfo: { likedCount: '4.6万' },
                            user: { userId: 'user-1' },
                        },
                    },
                    {
                        noteCard: {
                            note_id: 'note-2',
                            display_title: 'Second note',
                            type: 'normal',
                            interact_info: { liked_count: 42 },
                        },
                    },
                ],
                [],
            ],
        }, 'fallback-user');
        expect(rows).toEqual([
            {
                id: 'note-1',
                title: 'First note',
                type: 'video',
                likes: '4.6万',
                cover: '',
                url: 'https://www.xiaohongshu.com/user/profile/user-1/note-1?xsec_token=abc&xsec_source=pc_user',
            },
            {
                id: 'note-2',
                title: 'Second note',
                type: 'normal',
                likes: '42',
                cover: '',
                url: 'https://www.xiaohongshu.com/user/profile/fallback-user/note-2',
            },
        ]);
    });
    it('extracts cover urls with fallback priority urlDefault -> urlPre -> url', () => {
        const rows = extractXhsUserNotes({
            noteGroups: [
                [
                    { noteCard: { noteId: 'cover-1', cover: { urlDefault: 'https://img.example/default.jpg', urlPre: 'https://img.example/pre.jpg', url: 'https://img.example/raw.jpg' } } },
                    { noteCard: { noteId: 'cover-2', cover: { urlPre: 'https://img.example/pre-only.jpg', url: 'https://img.example/raw-only.jpg' } } },
                    { noteCard: { noteId: 'cover-3', cover: { url: 'https://img.example/raw-fallback.jpg' } } },
                ],
            ],
        }, 'fallback-user');
        expect(rows.map(row => row.cover)).toEqual([
            'https://img.example/default.jpg',
            'https://img.example/pre-only.jpg',
            'https://img.example/raw-fallback.jpg',
        ]);
    });
    it('deduplicates repeated notes by note id', () => {
        const rows = extractXhsUserNotes({
            noteGroups: [
                [
                    { noteCard: { noteId: 'dup-1', displayTitle: 'keep me' } },
                    { noteCard: { noteId: 'dup-1', displayTitle: 'drop me' } },
                ],
            ],
        }, 'fallback-user');
        expect(rows).toHaveLength(1);
        expect(rows[0]?.title).toBe('keep me');
    });
});
