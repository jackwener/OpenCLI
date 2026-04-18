import { describe, expect, it } from 'vitest';
import { extractListEntry, parseListsManagement } from './lists.js';

describe('twitter lists parser', () => {
    it('extracts a list entry with full metadata', () => {
        const entry = {
            content: {
                itemContent: {
                    list: {
                        id_str: '1597593475389984769',
                        name: 'Crypto',
                        member_count: 44,
                        subscriber_count: 8747,
                        mode: 'Public',
                    },
                },
            },
        };
        expect(extractListEntry(entry, new Set())).toEqual({
            id: '1597593475389984769',
            name: 'Crypto',
            members: '44',
            followers: '8747',
            mode: 'public',
        });
    });

    it('maps Private mode to private', () => {
        const entry = {
            content: {
                itemContent: {
                    list: {
                        id_str: '2044679538156912976',
                        name: 'AI & Agents',
                        member_count: 15,
                        subscriber_count: 0,
                        mode: 'Private',
                    },
                },
            },
        };
        expect(extractListEntry(entry, new Set())?.mode).toBe('private');
    });

    it('deduplicates by list id', () => {
        const entry = {
            content: { itemContent: { list: { id_str: '1', name: 'X' } } },
        };
        const seen = new Set();
        expect(extractListEntry(entry, seen)).not.toBeNull();
        expect(extractListEntry(entry, seen)).toBeNull();
    });

    it('returns null when no list payload is present', () => {
        expect(extractListEntry({}, new Set())).toBeNull();
        expect(extractListEntry({ content: { itemContent: {} } }, new Set())).toBeNull();
    });

    it('parses ListsManagementPageTimeline payload instructions', () => {
        const payload = {
            data: {
                viewer: {
                    list_management_timeline: {
                        timeline: {
                            instructions: [
                                {
                                    entries: [
                                        {
                                            entryId: 'owned-list-1',
                                            content: {
                                                itemContent: {
                                                    list: { id_str: '1', name: 'Crypto', member_count: 44, subscriber_count: 8747, mode: 'Public' },
                                                },
                                            },
                                        },
                                        {
                                            entryId: 'subscribed-list-2',
                                            content: {
                                                itemContent: {
                                                    list: { id_str: '2', name: 'AI', member_count: 15, subscriber_count: 0, mode: 'Private' },
                                                },
                                            },
                                        },
                                    ],
                                },
                            ],
                        },
                    },
                },
            },
        };
        const result = parseListsManagement(payload, new Set());
        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({ id: '1', name: 'Crypto', mode: 'public' });
        expect(result[1]).toMatchObject({ id: '2', name: 'AI', mode: 'private' });
    });

    it('returns empty list for malformed payload', () => {
        expect(parseListsManagement({}, new Set())).toEqual([]);
        expect(parseListsManagement({ data: {} }, new Set())).toEqual([]);
    });

    it('dedupes across repeated entries', () => {
        const entryA = { content: { itemContent: { list: { id_str: '1', name: 'A' } } } };
        const payload = {
            data: {
                viewer: {
                    list_management_timeline: {
                        timeline: { instructions: [{ entries: [entryA, entryA] }] },
                    },
                },
            },
        };
        const result = parseListsManagement(payload, new Set());
        expect(result).toHaveLength(1);
    });
});
