import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import './list-remove.js';

function buildListsPayload(listId = '123', memberCount = 10) {
    return {
        data: {
            viewer: {
                list_management_timeline: {
                    timeline: {
                        instructions: [{
                            entries: [{
                                entryId: 'owned-subscribed-list-module-0',
                                content: {
                                    items: [{
                                        item: {
                                            itemContent: {
                                                list: {
                                                    id_str: listId,
                                                    name: 'My List',
                                                    member_count: memberCount,
                                                    subscriber_count: 0,
                                                    mode: 'Public',
                                                },
                                            },
                                        },
                                    }],
                                },
                            }],
                        }],
                    },
                },
            },
        },
    };
}

function buildRemovePage(afterPayload) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        getCookies: vi.fn().mockResolvedValue([{ name: 'ct0', value: 'token' }]),
        nativeClick: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn()
            .mockResolvedValueOnce(null) // UserByScreenName queryId fallback
            .mockResolvedValueOnce('user-1')
            .mockResolvedValueOnce(null) // ListsManagement queryId fallback
            .mockResolvedValueOnce(buildListsPayload('123', 10))
            .mockResolvedValueOnce({ ok: true, needsNativeInteraction: true, rowClickX: 1, rowClickY: 2, saveClickX: 3, saveClickY: 4 })
            .mockResolvedValueOnce(afterPayload),
    };
}

describe('twitter list-remove registration', () => {
    it('registers the list-remove command with the expected shape', () => {
        const cmd = getRegistry().get('twitter/list-remove');
        expect(cmd?.func).toBeTypeOf('function');
        expect(cmd?.columns).toEqual(['listId', 'username', 'userId', 'status', 'message']);
        const listIdArg = cmd?.args?.find((a) => a.name === 'listId');
        expect(listIdArg).toBeTruthy();
        expect(listIdArg?.required).toBe(true);
    });

    it('keeps the x.com root navigation before pre-target GraphQL calls', async () => {
        const cmd = getRegistry().get('twitter/list-remove');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            getCookies: vi.fn().mockResolvedValue([{ name: 'ct0', value: 'token' }]),
            evaluate: vi.fn()
                .mockResolvedValueOnce(null) // UserByScreenName queryId fallback
                .mockResolvedValueOnce('user-1')
                .mockResolvedValueOnce(null) // ListsManagement queryId fallback
                .mockResolvedValueOnce({}),
        };

        await expect(cmd.func(page, { listId: '123', username: 'alice' }))
            .rejects
            .toThrow(/List 123 not found/);
        expect(page.goto).toHaveBeenCalledWith('https://x.com');
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.wait).toHaveBeenCalledWith(3);
        expect(page.getCookies).toHaveBeenCalledWith({ url: 'https://x.com' });
    });

    it('rejects invalid user input before navigation', async () => {
        const cmd = getRegistry().get('twitter/list-remove');
        const page = {
            goto: vi.fn(),
            wait: vi.fn(),
            getCookies: vi.fn(),
            evaluate: vi.fn(),
        };

        await expect(cmd.func(page, { listId: 'abc', username: 'alice' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(cmd.func(page, { listId: '123', username: '' })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('unwraps Browser Bridge envelopes for user lookup and UI action results', async () => {
        const cmd = getRegistry().get('twitter/list-remove');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            getCookies: vi.fn().mockResolvedValue([{ name: 'ct0', value: 'token' }]),
            evaluate: vi.fn()
                .mockResolvedValueOnce(null) // UserByScreenName queryId fallback
                .mockResolvedValueOnce({ session: 'site:twitter', data: 'user-1' })
                .mockResolvedValueOnce(null) // ListsManagement queryId fallback
                .mockResolvedValueOnce({ session: 'site:twitter', data: buildListsPayload('123', 10) })
                .mockResolvedValueOnce({ session: 'site:twitter', data: { ok: true, noop: true } }),
        };

        await expect(cmd.func(page, { listId: '123', username: 'alice' })).resolves.toEqual([{
            listId: '123',
            username: 'alice',
            userId: 'user-1',
            status: 'noop',
            message: '@alice was not a member of list 123',
        }]);
    });

    it('does not treat post-delete fetch failure as successful member_count decrease', async () => {
        const cmd = getRegistry().get('twitter/list-remove');
        const page = buildRemovePage({ __error: 'HTTP 500' });

        await expect(cmd.func(page, { listId: '123', username: 'alice' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('does not treat malformed post-delete payload as successful member_count decrease', async () => {
        const cmd = getRegistry().get('twitter/list-remove');
        const page = buildRemovePage({ data: {} });

        await expect(cmd.func(page, { listId: '123', username: 'alice' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('does not treat a missing target list in post-delete payload as success', async () => {
        const cmd = getRegistry().get('twitter/list-remove');
        const page = buildRemovePage(buildListsPayload('456', 1));

        await expect(cmd.func(page, { listId: '123', username: 'alice' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });
});
