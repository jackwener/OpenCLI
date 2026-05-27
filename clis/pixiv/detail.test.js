import { beforeAll, describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { createPageMock } from '../test-utils.js';
import './detail.js';
let cmd;
beforeAll(() => {
    cmd = getRegistry().get('pixiv/detail');
    expect(cmd?.func).toBeTypeOf('function');
});
describe('pixiv detail', () => {
    it('throws CommandExecutionError on invalid illustration ID', async () => {
        const page = createPageMock([]);
        await expect(cmd.func(page, { id: 'xyz' })).rejects.toThrow(CommandExecutionError);
    });
    it('throws AuthRequiredError on 401', async () => {
        const page = createPageMock([{ __httpError: 401 }]);
        await expect(cmd.func(page, { id: '12345' })).rejects.toThrow(AuthRequiredError);
    });
    it('throws CommandExecutionError on 404', async () => {
        const page = createPageMock([{ __httpError: 404 }]);
        await expect(cmd.func(page, { id: '12345' })).rejects.toThrow(CommandExecutionError);
    });
    it('throws CommandExecutionError on non-auth HTTP failure', async () => {
        const page = createPageMock([{ __httpError: 500 }]);
        await expect(cmd.func(page, { id: '12345' })).rejects.toThrow(CommandExecutionError);
    });
    it('returns detail row with mapped fields', async () => {
        const page = createPageMock([
            {
                body: {
                    illustId: '12345',
                    illustTitle: 'Test Illust',
                    userName: 'Test Artist',
                    userId: '99',
                    illustType: 1,
                    pageCount: 4,
                    bookmarkCount: 200,
                    likeCount: 100,
                    viewCount: 5000,
                    tags: { tags: [{ tag: 'original' }, { tag: 'fantasy' }] },
                    createDate: '2025-01-15T12:00:00+09:00',
                },
            },
        ]);
        const result = await cmd.func(page, { id: '12345' });
        expect(result).toEqual([{
            illust_id: '12345',
            title: 'Test Illust',
            author: 'Test Artist',
            user_id: '99',
            type: 'manga',
            pages: 4,
            bookmarks: 200,
            likes: 100,
            views: 5000,
            tags: 'original, fantasy',
            created: '2025-01-15',
            url: 'https://www.pixiv.net/artworks/12345',
        }]);
    });
});
