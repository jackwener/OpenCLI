import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import {
    COLLECT_API_PATTERN,
    EXTRACT_COLLECTION_DOM_JS,
    LIKE_API_PATTERN,
    LIKED_PROFILE_TAB,
    SAVED_PROFILE_TAB,
    buildProfileCollectionUrl,
    extractNotesFromResponses,
    fetchXhsCollectionNotes,
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
        expect(parseCollectionLimit()).toBe(20);
        expect(parseCollectionLimit('20')).toBe(20);
        expect(parseCollectionLimit(500)).toBe(500);
        expect(() => parseCollectionLimit(0)).toThrow(/between 1 and 500/);
        expect(() => parseCollectionLimit(501)).toThrow(/between 1 and 500/);
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

const userId = '66c876f7000000001d023624';

function makeNote(number) {
    return {
        id: `note-${number}`,
        xsecToken: `token-${number}`,
        noteCard: {
            displayTitle: `Note ${number}`,
            type: 'normal',
            user: { userId: 'author-id', nickname: 'Alice' },
            interactInfo: { likedCount: '12' },
        },
    };
}

function makeStore(tab, initialNotes, fetchPage) {
    const activeTab = { query: tab, index: 2 };
    const activeSubTab = { query: 'note', index: 4 };
    const index = tab === LIKED_PROFILE_TAB ? activeTab.index : activeSubTab.index;
    const notes = [...initialNotes];
    const query = { cursor: 'initial', page: 1, hasMore: true };
    const store = {
        activeTab,
        activeSubTab,
        notes: { [index]: notes },
        noteQueries: { [index]: query },
        fetchNotes: vi.fn((requestedIndex) => {
            expect(requestedIndex).toBe(index);
            return fetchPage(notes, query);
        }),
    };
    return store;
}

function makePage(tab, { store, container = null, readDom = () => [] } = {}) {
    const location = new URL(buildProfileCollectionUrl(userId, tab));
    const app = store ? { __vue_app__: { config: { globalProperties: { $pinia: { _s: new Map([['user', store]]) } } } } } : null;
    const document = {
        querySelector: (selector) => ({ '#app': app, '#userPageContainer': container }[selector] ?? null),
    };
    return {
        goto: vi.fn(),
        wait: vi.fn(),
        evaluate: vi.fn(async (script) => script === EXTRACT_COLLECTION_DOM_JS
            ? readDom() : runInNewContext(script, { document, location, window: {} })),
        installInterceptor: vi.fn(),
        getInterceptedRequests: vi.fn(() => []),
        autoScroll: vi.fn(),
    };
}

function fetchNotes(page, profileTab, limit) {
    const liked = profileTab === LIKED_PROFILE_TAB;
    return fetchXhsCollectionNotes(page, {
        userId, profileTab, limit,
        apiPattern: liked ? LIKE_API_PATTERN : COLLECT_API_PATTERN,
        emptyLabel: liked ? 'liked' : 'saved',
    });
}

describe('xiaohongshu collection pagination', () => {
    it('pages past four requests until it reaches the limit', async () => {
        const store = makeStore(SAVED_PROFILE_TAB, [makeNote(1)], (notes, query) => {
            const count = notes.length;
            notes.push(...Array.from({ length: 20 }, (_, i) => makeNote(count + i + 1)));
            // A change in either paging field signals progress.
            query.page += 1;
        });
        const page = makePage(SAVED_PROFILE_TAB, { store });

        const rows = await fetchNotes(page, SAVED_PROFILE_TAB, 110);

        expect(rows).toHaveLength(110);
        expect(rows.at(-1)).toEqual({
            rank: 110, id: 'note-110', title: 'Note 110', author: 'Alice', likes: '12', type: 'normal',
            url: 'https://www.xiaohongshu.com/user/profile/author-id/note-110?xsec_token=token-110&xsec_source=pc_user',
        });
        expect(store.fetchNotes).toHaveBeenCalledTimes(6);
        expect(page.wait.mock.calls.filter(([delay]) => delay === 0.65)).toHaveLength(6);
        expect(page.installInterceptor).not.toHaveBeenCalled();
    });

    it('uses the liked tab index and stops when hasMore is false', async () => {
        const store = makeStore(LIKED_PROFILE_TAB, [makeNote(1)], (notes, query) => {
            notes.push(makeNote(2));
            query.hasMore = false;
        });
        const page = makePage(LIKED_PROFILE_TAB, { store });

        expect((await fetchNotes(page, LIKED_PROFILE_TAB, 10)).map((row) => row.id)).toEqual(['note-1', 'note-2']);
        expect(store.fetchNotes).toHaveBeenCalledTimes(1);
    });

    it.each(['unchanged cursor and page', 'shrinking note list'])('stops on a stall with %s', async (kind) => {
        const store = makeStore(SAVED_PROFILE_TAB, [makeNote(1), makeNote(2)], (notes, query) => {
            if (kind === 'shrinking note list') {
                notes.pop();
                query.page += 1;
            }
        });
        const page = makePage(SAVED_PROFILE_TAB, { store });

        expect((await fetchNotes(page, SAVED_PROFILE_TAB, 10)).map((row) => row.id)).toEqual(['note-1', 'note-2']);
        expect(store.fetchNotes).toHaveBeenCalledTimes(1);
    });

    it('returns collected rows when the next page is blocked with HTTP 461', async () => {
        const store = makeStore(SAVED_PROFILE_TAB, [makeNote(1)], () => {
            throw { response: { status: 461 } };
        });
        const page = makePage(SAVED_PROFILE_TAB, { store });

        expect((await fetchNotes(page, SAVED_PROFILE_TAB, 10)).map((row) => row.id)).toEqual(['note-1']);
        expect(store.fetchNotes).toHaveBeenCalledTimes(1);
        expect(page.installInterceptor).not.toHaveBeenCalled();
    });

    it.each([429, 461])('throws SECURITY_BLOCK on HTTP %i before collecting rows', async (status) => {
        const store = makeStore(SAVED_PROFILE_TAB, [], () => {
            throw { response: { status } };
        });
        const page = makePage(SAVED_PROFILE_TAB, { store });

        await expect(fetchNotes(page, SAVED_PROFILE_TAB, 10)).rejects.toMatchObject({ code: 'SECURITY_BLOCK' });
        expect(store.fetchNotes).toHaveBeenCalledTimes(1);
        expect(page.installInterceptor).not.toHaveBeenCalled();
    });

    it.each([undefined, {}])('falls back when the store or action is unavailable (%j)', async (store) => {
        const container = { scrollTop: 0, scrollHeight: 800 };
        const page = makePage(SAVED_PROFILE_TAB, { store, container, readDom: () => [mapCollectionNote(makeNote(1))] });
        page.getInterceptedRequests.mockImplementation(() => container.scrollTop
            ? [{ data: { notes: [makeNote(2)] } }] : []);

        expect((await fetchNotes(page, SAVED_PROFILE_TAB, 2)).map((row) => row.id)).toEqual(['note-1', 'note-2']);
        expect(page.goto.mock.invocationCallOrder[0]).toBeLessThan(page.installInterceptor.mock.invocationCallOrder[0]);
        expect(container.scrollTop).toBe(container.scrollHeight);
        expect(page.autoScroll).not.toHaveBeenCalled();
    });
});
