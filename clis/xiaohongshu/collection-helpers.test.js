import { describe, expect, it } from 'vitest';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import {
    COLLECT_API_PATTERN,
    LIKE_API_PATTERN,
    LIKED_PROFILE_TAB,
    SAVED_PROFILE_TAB,
    buildProfileCollectionUrl,
    extractNotesFromResponses,
    mapCollectionNote,
    parseCollectionLimit,
    readSelfUserIdFromState,
} from './collection-helpers.js';

describe('xiaohongshu collection helpers', () => {
    it('reads the logged-in user id from INITIAL_STATE', () => {
        expect(readSelfUserIdFromState({
            user: {
                userInfo: {
                    _value: { user_id: 'abc123' },
                },
            },
        })).toBe('abc123');
    });

    it('unwraps Browser Bridge envelopes when reading logged-in user id', () => {
        expect(readSelfUserIdFromState({
            session: 's1',
            data: {
                user: {
                    userInfo: { userId: 'self-user' },
                },
            },
        })).toBe('self-user');
    });

    it('validates collection limits instead of silently clamping', () => {
        expect(parseCollectionLimit('20')).toBe(20);
        expect(() => parseCollectionLimit(0)).toThrow(/between 1 and 100/);
        expect(() => parseCollectionLimit(101)).toThrow(/between 1 and 100/);
        expect(() => parseCollectionLimit('1.5')).toThrow(/integer/);
    });

    it('maps collect API notes with xsec_token into profile URLs', () => {
        const row = mapCollectionNote({
            note_id: '662908190000000001007366',
            xsec_token: 'token-1',
            note_card: {
                display_title: 'Saved note',
                type: 'normal',
                user: { user_id: 'user-1', nickname: 'Alice' },
                interact_info: { liked_count: '12' },
            },
        }, { fallbackUserId: 'fallback' });
        expect(row).toMatchObject({
            id: '662908190000000001007366',
            title: 'Saved note',
            author: 'Alice',
            likes: '12',
            type: 'normal',
            url: 'https://www.xiaohongshu.com/user/profile/user-1/662908190000000001007366?xsec_token=token-1&xsec_source=pc_user',
        });
    });

    it('dedupes notes across multiple intercepted responses', () => {
        const requests = [
            {
                data: {
                    notes: [
                        {
                            note_id: 'note-1',
                            xsec_token: 'tok-1',
                            title: 'First',
                            user: { nickname: 'A' },
                            interact_info: { liked_count: '1' },
                        },
                    ],
                },
            },
            {
                data: {
                    notes: [
                        {
                            note_id: 'note-1',
                            xsec_token: 'tok-1b',
                            title: 'First duplicate',
                            user: { nickname: 'A' },
                            interact_info: { liked_count: '1' },
                        },
                        {
                            note_id: 'note-2',
                            xsec_token: 'tok-2',
                            title: 'Second',
                            user: { nickname: 'B' },
                            interact_info: { liked_count: '2' },
                        },
                    ],
                },
            },
        ];
        const rows = extractNotesFromResponses(requests, 'self');
        expect(rows).toHaveLength(2);
        expect(rows.map((row) => row.id)).toEqual(['note-1', 'note-2']);
    });

    it('fails closed when intercepted collection payload shape is malformed', () => {
        expect(() => extractNotesFromResponses([{ data: { notes: null } }], 'self'))
            .toThrow(CommandExecutionError);
        expect(() => extractNotesFromResponses([{ data: { notes: [{ note_id: 'note-1' }] } }], 'self'))
            .toThrow(/stable id\/xsec token/);
    });

    it('uses the expected API patterns', () => {
        expect(COLLECT_API_PATTERN).toBe('note/collect/page');
        expect(LIKE_API_PATTERN).toBe('note/like/page');
    });

    it('builds profile URLs for saved and liked tabs', () => {
        const userId = '66c876f7000000001d023624';
        expect(buildProfileCollectionUrl(userId, SAVED_PROFILE_TAB))
            .toBe('https://www.xiaohongshu.com/user/profile/66c876f7000000001d023624?tab=fav&subTab=note');
        expect(buildProfileCollectionUrl(userId, LIKED_PROFILE_TAB))
            .toBe('https://www.xiaohongshu.com/user/profile/66c876f7000000001d023624?tab=liked&subTab=note');
    });
});
