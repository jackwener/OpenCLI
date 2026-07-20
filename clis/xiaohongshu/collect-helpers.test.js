import { describe, expect, it } from 'vitest';
import { normalizeXhsUserId, normalizeBoardId, looksLikeId, buildExploreUrl, unwrap, mapBoard, mapCollectedNote, matchBoard, } from './collect-helpers.js';

// All ids below are synthetic 24-char hex placeholders, not real accounts.
const USER_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const BOARD_A = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const BOARD_B = 'cccccccccccccccccccccccc';
const BOARD_C = 'dddddddddddddddddddddddd';
const NOTE_ID = 'eeeeeeeeeeeeeeeeeeeeeeee';

describe('normalizeXhsUserId', () => {
    it('extracts the profile id from a full URL', () => {
        expect(normalizeXhsUserId(`https://www.xiaohongshu.com/user/profile/${USER_ID}?tab=fav`)).toBe(USER_ID);
    });
    it('keeps a bare id unchanged', () => {
        expect(normalizeXhsUserId(USER_ID)).toBe(USER_ID);
    });
});

describe('normalizeBoardId', () => {
    it('extracts the board id from a /board/ URL with query', () => {
        expect(normalizeBoardId(`https://www.xiaohongshu.com/board/${BOARD_A}?source=web_user_page`)).toBe(BOARD_A);
    });
    it('keeps a bare board id unchanged', () => {
        expect(normalizeBoardId(BOARD_A)).toBe(BOARD_A);
    });
    it('returns non-id names untouched (so they can be name-matched)', () => {
        expect(normalizeBoardId('AI')).toBe('AI');
    });
});

describe('looksLikeId', () => {
    it('accepts a 24-char hex id', () => {
        expect(looksLikeId(BOARD_A)).toBe(true);
    });
    it('rejects a board name', () => {
        expect(looksLikeId('AI')).toBe(false);
        expect(looksLikeId('3d 打印')).toBe(false);
    });
    it('rejects the wrong length / non-hex', () => {
        expect(looksLikeId('bbbbbbbb')).toBe(false);
        expect(looksLikeId('zzzzzzzzzzzzzzzzzzzzzzzz')).toBe(false);
    });
});

describe('buildExploreUrl', () => {
    it('appends xsec token and source when present', () => {
        expect(buildExploreUrl('note123', 'tok=456')).toBe('https://www.xiaohongshu.com/explore/note123?xsec_token=tok%3D456&xsec_source=pc_user');
    });
    it('omits query when no token', () => {
        expect(buildExploreUrl('note123', '')).toBe('https://www.xiaohongshu.com/explore/note123');
    });
    it('returns empty string without a note id', () => {
        expect(buildExploreUrl('', 'tok')).toBe('');
    });
});

describe('unwrap', () => {
    it('unwraps a full response body', () => {
        expect(unwrap({ code: 0, data: { notes: [1] } })).toEqual({ notes: [1] });
    });
    it('passes through an already-unwrapped data object', () => {
        expect(unwrap({ notes: [1] })).toEqual({ notes: [1] });
    });
    it('tolerates null', () => {
        expect(unwrap(null)).toEqual({});
    });
});

describe('mapBoard', () => {
    it('maps a raw board with total -> count', () => {
        expect(mapBoard({ id: BOARD_A, name: 'AI', total: 305, privacy: '0', desc: '暂无简介' })).toEqual({
            id: BOARD_A,
            name: 'AI',
            count: 305,
            privacy: '0',
            desc: '暂无简介',
        });
    });
    it('defaults count to 0 when total missing', () => {
        expect(mapBoard({ id: BOARD_B, name: '游戏' }).count).toBe(0);
    });
});

describe('mapCollectedNote', () => {
    it('maps a snake_case API note (board/note, collect/page)', () => {
        const row = mapCollectedNote({
            note_id: NOTE_ID,
            display_title: '徒步 vlog',
            type: 'video',
            xsec_token: 'ABtoken=',
            user: { nick_name: 'creator-a' },
            interact_info: { liked_count: '166', collected_count: '122' },
        });
        expect(row).toEqual({
            id: NOTE_ID,
            title: '徒步 vlog',
            author: 'creator-a',
            type: 'video',
            likes: '166',
            url: `https://www.xiaohongshu.com/explore/${NOTE_ID}?xsec_token=ABtoken%3D&xsec_source=pc_user`,
        });
    });
    it('maps a camelCase SSR-store note (boardFeedsMap)', () => {
        const row = mapCollectedNote({
            noteId: NOTE_ID,
            displayTitle: 'html 编辑器使用教程',
            type: 'video',
            xsecToken: 'AB2tz=',
            user: { nickName: 'creator-b' },
            interactInfo: { likedCount: '31' },
        });
        expect(row).toMatchObject({
            id: NOTE_ID,
            title: 'html 编辑器使用教程',
            author: 'creator-b',
            likes: '31',
        });
        expect(row.url).toContain('xsec_token=AB2tz%3D');
    });
    it('defaults likes to "0" and tolerates a missing user', () => {
        const row = mapCollectedNote({ note_id: 'n1', display_title: 't' });
        expect(row.likes).toBe('0');
        expect(row.author).toBe('');
    });
    it('returns null for a note without an id', () => {
        expect(mapCollectedNote({ display_title: 'no id' })).toBeNull();
        expect(mapCollectedNote(null)).toBeNull();
    });
});

describe('matchBoard', () => {
    const boards = [
        { id: BOARD_A, name: '打卡', count: 225 },
        { id: BOARD_B, name: 'AI', count: 305 },
        { id: BOARD_C, name: '3d 打印', count: 58 },
    ];
    it('matches by exact 24-hex id from a URL', () => {
        expect(matchBoard(boards, `https://www.xiaohongshu.com/board/${BOARD_B}?source=x`)?.name).toBe('AI');
    });
    it('returns a bare stub for an unknown id', () => {
        expect(matchBoard(boards, 'ffffffffffffffffffffffff')).toEqual({ id: 'ffffffffffffffffffffffff', name: '' });
    });
    it('matches by exact name case-insensitively', () => {
        expect(matchBoard(boards, 'ai')?.id).toBe(BOARD_B);
    });
    it('falls back to substring name match', () => {
        expect(matchBoard(boards, '打印')?.name).toBe('3d 打印');
    });
    it('returns null when a name matches nothing', () => {
        expect(matchBoard(boards, '不存在')).toBeNull();
    });
});
