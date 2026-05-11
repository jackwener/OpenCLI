import { describe, expect, it } from 'vitest';
import { extractListEntry, isOwnedSubscribedEntry, parseListsManagement } from './lists.js';

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

    it('parses ListsManagementPageTimeline payload instructions (real shape: nested module items)', () => {
        const payload = {
            data: {
                viewer: {
                    list_management_timeline: {
                        timeline: {
                            instructions: [
                                {
                                    type: 'TimelineAddEntries',
                                    entries: [
                                        {
                                            entryId: 'owned-subscribed-list-module-0',
                                            content: {
                                                entryType: 'TimelineTimelineModule',
                                                items: [
                                                    {
                                                        entryId: 'owned-subscribed-list-module-0-list-1',
                                                        item: {
                                                            itemContent: {
                                                                itemType: 'TimelineTwitterList',
                                                                list: { id_str: '1', name: 'AI & Agents', member_count: 33, subscriber_count: 0, mode: 'Private' },
                                                            },
                                                        },
                                                    },
                                                    {
                                                        entryId: 'owned-subscribed-list-module-0-list-2',
                                                        item: {
                                                            itemContent: {
                                                                itemType: 'TimelineTwitterList',
                                                                list: { id_str: '2', name: 'Anthropic Team', member_count: 10, subscriber_count: 0, mode: 'Public' },
                                                            },
                                                        },
                                                    },
                                                ],
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
        expect(result[0]).toMatchObject({ id: '1', name: 'AI & Agents', mode: 'private' });
        expect(result[1]).toMatchObject({ id: '2', name: 'Anthropic Team', mode: 'public' });
    });

    it('skips "Discover new Lists" recommendations (list-to-follow-module-*)', () => {
        // 真实 X.com /<user>/lists 响应：Discover 推荐 + Your Lists 同 instruction，
        // 区别只在 entry.entryId 前缀。Parser 必须按前缀剔除推荐。
        const payload = {
            data: {
                viewer: {
                    list_management_timeline: {
                        timeline: {
                            instructions: [
                                {
                                    type: 'TimelineAddEntries',
                                    entries: [
                                        {
                                            entryId: 'list-to-follow-module-2050754937725386752',
                                            content: {
                                                entryType: 'TimelineTimelineModule',
                                                items: [
                                                    {
                                                        entryId: 'list-to-follow-module-XYZ-list-1597593475389984769',
                                                        item: { itemContent: { itemType: 'TimelineTwitterList', list: { id_str: '1597593475389984769', name: 'Crypto', member_count: 44, subscriber_count: 8947, mode: 'Public' } } },
                                                    },
                                                    {
                                                        entryId: 'list-to-follow-module-XYZ-list-1499395616262217730',
                                                        item: { itemContent: { itemType: 'TimelineTwitterList', list: { id_str: '1499395616262217730', name: 'Crypto Blockchain', member_count: 24, subscriber_count: 1166, mode: 'Public' } } },
                                                    },
                                                ],
                                            },
                                        },
                                        {
                                            entryId: 'owned-subscribed-list-module-0',
                                            content: {
                                                entryType: 'TimelineTimelineModule',
                                                items: [
                                                    {
                                                        entryId: 'owned-subscribed-list-module-0-list-2044679538156912976',
                                                        item: { itemContent: { itemType: 'TimelineTwitterList', list: { id_str: '2044679538156912976', name: 'AI & Agents', member_count: 33, subscriber_count: 0, mode: 'Private' } } },
                                                    },
                                                ],
                                            },
                                        },
                                        {
                                            entryId: 'cursor-bottom-2050754937725386750',
                                            content: { entryType: 'TimelineTimelineCursor' },
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
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ id: '2044679538156912976', name: 'AI & Agents' });
        // No Crypto/Blockchain leakage
        expect(result.find(l => l.name === 'Crypto')).toBeUndefined();
        expect(result.find(l => l.name === 'Crypto Blockchain')).toBeUndefined();
    });

    it('isOwnedSubscribedEntry classifies entryIds', () => {
        expect(isOwnedSubscribedEntry({ entryId: 'owned-subscribed-list-module-0' })).toBe(true);
        expect(isOwnedSubscribedEntry({ entryId: 'list-to-follow-module-2050754937725386752' })).toBe(false);
        expect(isOwnedSubscribedEntry({ entryId: 'cursor-bottom-XYZ' })).toBe(false);
        expect(isOwnedSubscribedEntry({})).toBe(false);
        expect(isOwnedSubscribedEntry({ entryId: null })).toBe(false);
    });

    it('returns empty list for malformed payload', () => {
        expect(parseListsManagement({}, new Set())).toEqual([]);
        expect(parseListsManagement({ data: {} }, new Set())).toEqual([]);
    });

    it('dedupes across repeated entries within owned-subscribed module', () => {
        const itemA = {
            entryId: 'owned-subscribed-list-module-0-list-1',
            item: { itemContent: { list: { id_str: '1', name: 'A' } } },
        };
        const payload = {
            data: {
                viewer: {
                    list_management_timeline: {
                        timeline: {
                            instructions: [{
                                entries: [{
                                    entryId: 'owned-subscribed-list-module-0',
                                    content: { items: [itemA, itemA] },
                                }],
                            }],
                        },
                    },
                },
            },
        };
        const result = parseListsManagement(payload, new Set());
        expect(result).toHaveLength(1);
    });
});
