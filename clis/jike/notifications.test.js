import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './notifications.js';

const identity = {
    ok: true,
    user_id: 'user-1',
    screen_name: 'Alice',
    username: 'alice',
};

function makePage(...evaluateResults) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockImplementation(async () => evaluateResults.shift()),
    };
}

function notification(id, type, overrides = {}) {
    return {
        id,
        type,
        createdAt: '2026-08-25T00:00:00.000Z',
        actionItem: {
            users: [{ screenName: 'Bob' }],
        },
        ...overrides,
    };
}

function apiPage(data, loadMoreKey = null, overrides = {}) {
    return {
        kind: 'response',
        status: 200,
        body: { data, loadMoreKey, ...overrides },
    };
}

function command() {
    return getRegistry().get('jike/notifications');
}

describe('jike notifications API pagination', () => {
    it('follows loadMoreKey, deduplicates notifications, and stops at upstream exhaustion', async () => {
        const page = makePage(
            identity,
            apiPage([notification('notification-1', 'USER_FOLLOWED')], { skip: 20 }),
            apiPage([
                notification('notification-1', 'USER_FOLLOWED'),
                notification('notification-2', 'PERSONAL_UPDATE_REPOSTED'),
            ]),
        );

        const rows = await command().func(page, { limit: 50 });
        expect(rows.map((row) => row.type)).toEqual(['关注了你', '转发了你的动态']);
        expect(page.evaluate).toHaveBeenCalledTimes(3);
        expect(page.evaluate.mock.calls[2][0]).toContain('"skip":20');
    });

    it('does not validate an unused cursor after satisfying --limit', async () => {
        const page = makePage(identity, apiPage([notification('notification-1', 'USER_FOLLOWED')], 'future-cursor-shape'));
        await expect(command().func(page, { limit: 1 })).resolves.toHaveLength(1);
    });

    it('returns EmptyResult only for a valid exhausted empty response', async () => {
        await expect(command().func(makePage(identity, apiPage([])), { limit: 20 }))
            .rejects.toBeInstanceOf(EmptyResultError);
    });

    it('rejects malformed notifications, users, and cursors instead of returning partial rows', async () => {
        await expect(command().func(makePage(identity, apiPage([
            notification('notification-1', 'USER_FOLLOWED'),
            { type: 'USER_FOLLOWED', actionItem: { users: [] } },
        ])), { limit: 20 })).rejects.toBeInstanceOf(CommandExecutionError);

        await expect(command().func(makePage(identity, apiPage([
            notification('notification-1', 'USER_FOLLOWED', { actionItem: { users: null } }),
        ])), { limit: 20 })).rejects.toBeInstanceOf(CommandExecutionError);

        await expect(command().func(makePage(identity, apiPage([], 'bad-cursor')), { limit: 20 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('malformed pagination cursor') });
    });

    it('rejects repeated cursors and page-budget exhaustion without returning accumulated rows', async () => {
        const cursor = { skip: 20 };
        await expect(command().func(makePage(
            identity,
            apiPage([notification('notification-1', 'USER_FOLLOWED')], cursor),
            apiPage([], cursor),
        ), { limit: 20 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('repeated cursor'),
        });

        const pages = Array.from({ length: 50 }, (_, index) => apiPage([], { skip: index + 1 }));
        await expect(command().func(makePage(identity, ...pages), { limit: 20 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('exceeded 50 pages') });
    });

});
