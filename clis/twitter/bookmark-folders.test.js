import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { __test__ } from './bookmark-folders.js';

const { parseBookmarkFolders, buildUrl } = __test__;

describe('twitter bookmark-folders parser', () => {
    it('returns [] for empty payload', () => {
        expect(parseBookmarkFolders({}, new Set())).toEqual([]);
        expect(parseBookmarkFolders({ data: {} }, new Set())).toEqual([]);
    });

    it('extracts folders from the modern viewer.bookmark_collections_slice envelope', () => {
        const data = {
            data: {
                viewer: {
                    bookmark_collections_slice: {
                        items: [
                            {
                                bookmarkCollection: {
                                    id_str: '1234567890',
                                    name: 'Reading list',
                                    bookmarks_count: 42,
                                    created_at: '2025-09-15T10:00:00.000Z',
                                },
                            },
                            {
                                bookmarkCollection: {
                                    id_str: '9876543210',
                                    name: 'Recipes',
                                    bookmarks_count: 7,
                                    created_at: '2026-01-03T03:14:00.000Z',
                                },
                            },
                        ],
                    },
                },
            },
        };
        expect(parseBookmarkFolders(data, new Set())).toEqual([
            { id: '1234567890', name: 'Reading list', items: 42, created_at: '2025-09-15T10:00:00.000Z' },
            { id: '9876543210', name: 'Recipes', items: 7, created_at: '2026-01-03T03:14:00.000Z' },
        ]);
    });

    it('falls back to legacy viewer_v2 envelope', () => {
        const data = {
            data: {
                viewer_v2: {
                    user_results: {
                        result: {
                            bookmark_collections_slice: {
                                items: [{ bookmarkCollection: { id: 'abc', name: 'Old', count: 3 } }],
                            },
                        },
                    },
                },
            },
        };
        expect(parseBookmarkFolders(data, new Set())).toEqual([
            { id: 'abc', name: 'Old', items: 3, created_at: '' },
        ]);
    });

    it('falls back to flat bookmark_collections_slice envelope', () => {
        const data = {
            data: {
                bookmark_collections_slice: {
                    items: [{ id_str: '5', name: 'Flat', bookmarks_count: 1, created_at: '2024-01-01' }],
                },
            },
        };
        expect(parseBookmarkFolders(data, new Set())).toEqual([
            { id: '5', name: 'Flat', items: 1, created_at: '2024-01-01' },
        ]);
    });

    it('deduplicates folders by id across the seen Set', () => {
        const data = {
            data: {
                viewer: {
                    bookmark_collections_slice: {
                        items: [
                            { bookmarkCollection: { id_str: '1', name: 'A', bookmarks_count: 0 } },
                            { bookmarkCollection: { id_str: '1', name: 'A again', bookmarks_count: 0 } },
                            { bookmarkCollection: { id_str: '2', name: 'B', bookmarks_count: 0 } },
                        ],
                    },
                },
            },
        };
        expect(parseBookmarkFolders(data, new Set())).toEqual([
            { id: '1', name: 'A', items: 0, created_at: '' },
            { id: '2', name: 'B', items: 0, created_at: '' },
        ]);
    });

    it('coerces missing items count to 0', () => {
        const data = {
            data: {
                viewer: {
                    bookmark_collections_slice: {
                        items: [{ bookmarkCollection: { id: '1', name: 'No count' } }],
                    },
                },
            },
        };
        expect(parseBookmarkFolders(data, new Set())[0].items).toBe(0);
    });

    it('skips entries without an id', () => {
        const data = {
            data: {
                viewer: {
                    bookmark_collections_slice: {
                        items: [
                            { bookmarkCollection: { name: 'Anonymous' } },
                            { bookmarkCollection: { id: '1', name: 'OK' } },
                        ],
                    },
                },
            },
        };
        expect(parseBookmarkFolders(data, new Set())).toEqual([
            { id: '1', name: 'OK', items: 0, created_at: '' },
        ]);
    });
});

describe('twitter bookmark-folders URL builder', () => {
    it('encodes the empty variables object and includes the queryId in the path', () => {
        const url = buildUrl('queryid123');
        expect(url).toContain('/i/api/graphql/queryid123/bookmarkFoldersSlice');
        expect(url).toContain('variables=' + encodeURIComponent('{}'));
        expect(url).toContain('features=');
    });
});

describe('twitter bookmark-folders command (registry)', () => {
    it('throws AuthRequiredError when ct0 cookie is missing', async () => {
        const command = getRegistry().get('twitter/bookmark-folders');
        expect(command?.func).toBeTypeOf('function');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            getCookies: vi.fn().mockResolvedValue([]), // no ct0 cookie → AuthRequired
            evaluate: vi.fn().mockResolvedValue(null),
        };
        await expect(command.func(page, {})).rejects.toThrow(/Not logged into x.com/);
        expect(page.getCookies).toHaveBeenCalledWith({ url: 'https://x.com' });
    });
});
