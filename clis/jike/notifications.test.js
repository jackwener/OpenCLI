import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
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
    it('maps the live avatar notification shape and preserves the four-column contract', async () => {
        const page = makePage(identity, apiPage([
            notification('notification-1', 'LIKE_AVATAR', {
                actionType: 'USER_LIST',
                actionItem: {
                    type: 'LIKE',
                    users: [{ screenName: 'Bob' }],
                    usersCount: 1,
                },
                referenceItem: { type: 'AVATAR', referenceImageUrl: 'https://example.com/avatar.png' },
            }),
        ], { skip: 20 }));

        await expect(command().func(page, { limit: 1 })).resolves.toEqual([{
            type: '弹了你的头像',
            user: 'Bob',
            content: '',
            time: '2026-08-25T00:00:00.000Z',
        }]);
        expect(command().columns).toEqual(['type', 'user', 'content', 'time']);
        expect(page.goto).toHaveBeenCalledWith('https://web.okjike.com/notification');
        expect(page.evaluate).toHaveBeenCalledTimes(2);
    });

    it('maps current bundle action types and content fields without DOM parsing', async () => {
        const page = makePage(identity, apiPage([
            notification('notification-1', 'COMMENT_PERSONAL_UPDATE', {
                actionItem: { users: [{ screenName: 'Bob' }], content: 'hello\nworld' },
            }),
            notification('notification-2', 'MENTION', {
                actionItem: { users: [{ screenName: 'Carol' }], content: '@Alice hi' },
            }),
            notification('notification-3', 'PRODUCT_PAGE_VOTED', {
                actionItem: { users: [{ screenName: 'Dave' }], behavior: '赞了你的产品页' },
                referenceItem: { content: 'OpenCLI' },
            }),
        ]));

        await expect(command().func(page, { limit: 20 })).resolves.toEqual([
            { type: '评论了你的动态', user: 'Bob', content: 'hello world', time: '2026-08-25T00:00:00.000Z' },
            { type: '@了你', user: 'Carol', content: '@Alice hi', time: '2026-08-25T00:00:00.000Z' },
            { type: '赞了你的产品页', user: 'Dave', content: 'OpenCLI', time: '2026-08-25T00:00:00.000Z' },
        ]);
    });

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

    it.each([
        [{ kind: 'auth', detail: 'expired' }, AuthRequiredError],
        [{ kind: 'response', status: 403, body: {} }, AuthRequiredError],
        [{ kind: 'transport', detail: 'offline' }, CommandExecutionError],
        [{ kind: 'json', status: 200, detail: 'bad json' }, CommandExecutionError],
        [{ kind: 'response', status: 500, body: {} }, CommandExecutionError],
        [{ unexpected: true }, CommandExecutionError],
        [{ kind: 'response', status: 200, body: { error: 'denied' } }, CommandExecutionError],
        [{ kind: 'response', status: 200, body: { data: null } }, CommandExecutionError],
    ])('maps API failure %# to a typed error', async (outcome, ErrorType) => {
        const page = makePage(identity, outcome);
        await expect(command().func(page, { limit: 20 })).rejects.toBeInstanceOf(ErrorType);
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

    it.each([
        [{ limit: 0 }, ArgumentError],
        [{ limit: 1.5 }, ArgumentError],
        [{ limit: '20' }, ArgumentError],
    ])('validates --limit before browser work: %#', async (args, ErrorType) => {
        const page = makePage();
        await expect(command().func(page, args)).rejects.toBeInstanceOf(ErrorType);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });
});
