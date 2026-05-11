import { beforeAll, describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { createPageMock } from '../test-utils.js';
import './illusts.js';
let cmd;
beforeAll(() => {
    cmd = getRegistry().get('pixiv/illusts');
    expect(cmd?.func).toBeTypeOf('function');
});
describe('pixiv illusts', () => {
    it('throws CommandExecutionError on invalid user ID', async () => {
        const page = createPageMock([]);
        await expect(cmd.func(page, { 'user-id': 'abc', limit: 5 })).rejects.toThrow(CommandExecutionError);
    });
    it('throws AuthRequiredError on 401', async () => {
        const page = createPageMock([{ __httpError: 401 }]);
        await expect(cmd.func(page, { 'user-id': '11', limit: 5 })).rejects.toThrow(AuthRequiredError);
    });
    it('throws generic error on non-auth HTTP failure', async () => {
        const page = createPageMock([{ __httpError: 500 }]);
        await expect(cmd.func(page, { 'user-id': '11', limit: 5 })).rejects.toThrow(CommandExecutionError);
    });
    it('returns empty array when user has no illusts', async () => {
        const page = createPageMock([
            { body: { illusts: {} } },
        ]);
        const result = await cmd.func(page, { 'user-id': '11', limit: 5 });
        expect(result).toEqual([]);
    });
    it('fetches illust IDs then batch-fetches details', async () => {
        const page = createPageMock([
            // Step 1: profile/all returns illust IDs
            {
                body: {
                    illusts: { '99999': null, '88888': null, '77777': null },
                },
            },
            // Step 2: batch detail response
            {
                body: {
                    works: {
                        '99999': {
                            id: '99999',
                            title: 'Latest Work',
                            pageCount: 2,
                            bookmarkCount: 300,
                            tags: ['original', 'fantasy'],
                            createDate: '2025-01-15T12:00:00+09:00',
                        },
                        '88888': {
                            id: '88888',
                            title: 'Older Work',
                            pageCount: 1,
                            bookmarkCount: 150,
                            tags: ['landscape'],
                            createDate: '2024-12-01T10:00:00+09:00',
                        },
                    },
                },
            },
        ]);
        const result = (await cmd.func(page, { 'user-id': '11', limit: 3 }));
        // Should be sorted newest first (99999 > 88888 > 77777)
        expect(result).toHaveLength(2); // 77777 has no detail data, filtered out
        expect(result[0]).toMatchObject({
            rank: 1,
            title: 'Latest Work',
            illust_id: '99999',
            pages: 2,
            bookmarks: 300,
            created: '2025-01-15',
        });
        expect(result[1]).toMatchObject({
            rank: 2,
            title: 'Older Work',
            illust_id: '88888',
        });
    });
    it('respects the limit on illust IDs fetched', async () => {
        const page = createPageMock([
            {
                body: {
                    illusts: { '100': null, '200': null, '300': null, '400': null, '500': null },
                },
            },
            {
                body: {
                    works: {
                        '500': { id: '500', title: 'W5', pageCount: 1, bookmarkCount: 0, tags: [], createDate: '' },
                        '400': { id: '400', title: 'W4', pageCount: 1, bookmarkCount: 0, tags: [], createDate: '' },
                    },
                },
            },
        ]);
        const result = (await cmd.func(page, { 'user-id': '11', limit: 2 }));
        expect(result).toHaveLength(2);
    });
});
