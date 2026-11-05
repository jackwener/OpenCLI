import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { __test__ } from './list-members.js';

function memberResult(screenName, restId = `id_${screenName}`) {
    return {
        __typename: 'User',
        rest_id: restId,
        is_blue_verified: screenName === 'alice',
        core: { screen_name: screenName, name: screenName.toUpperCase() },
        relationship_counts: { followers: 7 },
        legacy: { description: `${screenName} bio`, followers_count: 1 },
    };
}

function membersPayload(screenNames, nextCursor) {
    const entries = screenNames.map((name) => ({
        entryId: `user-id_${name}`,
        content: {
            entryType: 'TimelineTimelineItem',
            itemContent: { itemType: 'TimelineUser', user_results: { result: memberResult(name) } },
        },
    }));
    entries.push({ entryId: 'cursor-top-1', content: { entryType: 'TimelineTimelineCursor', cursorType: 'Top', value: 'TOP' } });
    if (nextCursor) {
        entries.push({ entryId: 'cursor-bottom-1', content: { entryType: 'TimelineTimelineCursor', cursorType: 'Bottom', value: nextCursor } });
    }
    return { data: { list: { members_timeline: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries }] } } } } };
}

function createPage(responses, { cookies = [{ name: 'ct0', value: 'token' }] } = {}) {
    return {
        getCookies: vi.fn(async () => cookies),
        evaluate: vi.fn(async (script) => {
            const text = String(script);
            if (text.includes('placeholder.json')) return { session: 'site:twitter', data: null };
            if (text.includes('/ListMembers')) return { session: 'site:twitter', data: responses.shift() ?? membersPayload([], null) };
            throw new Error(`Unexpected evaluate: ${text.slice(0, 80)}`);
        }),
    };
}

const command = () => getRegistry().get('twitter/list-members');
const memberCalls = (page) => page.evaluate.mock.calls
    .map(([script]) => decodeURIComponent(String(script)))
    .filter((text) => text.includes('/ListMembers'));

describe('twitter list-members helpers', () => {
    it('parses users and the bottom cursor, ignoring the top cursor', () => {
        const { users, nextCursor } = __test__.parseListMembers(membersPayload(['alice', 'bob'], 'NEXT'));
        expect(nextCursor).toBe('NEXT');
        expect(users).toEqual([
            { screen_name: 'alice', name: 'ALICE', bio: 'alice bio', followers: 7, verified: true, user_id: 'id_alice' },
            { screen_name: 'bob', name: 'BOB', bio: 'bob bio', followers: 7, verified: false, user_id: 'id_bob' },
        ]);
    });

    it('reports a missing members timeline distinctly from an empty one', () => {
        expect(__test__.parseListMembers({ data: {} }).instructions).toBeNull();
        expect(__test__.parseListMembers(membersPayload([], null)).instructions).toEqual(expect.any(Array));
    });

    it('skips unavailable users and fails loudly on a user without screen_name', () => {
        expect(__test__.extractMember({ __typename: 'UserUnavailable' })).toBeNull();
        expect(() => __test__.extractMember({ __typename: 'User', core: {}, legacy: {} })).toThrow(CommandExecutionError);
    });
});

describe('twitter list-members command', () => {
    it('paginates by cursor, deduplicates and respects --limit', async () => {
        const page = createPage([
            membersPayload(['alice', 'bob'], 'cursor-1'),
            membersPayload(['bob', 'carol', 'dave'], 'cursor-2'),
        ]);

        const rows = await command().func(page, { listId: '123', limit: 3 });

        expect(rows.map((row) => row.screen_name)).toEqual(['alice', 'bob', 'carol']);
        const calls = memberCalls(page);
        expect(calls).toHaveLength(2);
        expect(calls[0]).toContain('"listId":"123"');
        expect(calls[0]).toContain('/_RDpx--fQKSccuRlGpEIoA/ListMembers');
        expect(calls[1]).toContain('"cursor":"cursor-1"');
    });

    it('stops when the cursor repeats', async () => {
        const page = createPage([
            membersPayload(['alice'], 'same'),
            membersPayload(['bob'], 'same'),
            membersPayload(['carol'], 'other'),
        ]);

        const rows = await command().func(page, { listId: '123', limit: 50 });

        expect(rows.map((row) => row.screen_name)).toEqual(['alice', 'bob']);
        expect(memberCalls(page)).toHaveLength(2);
    });

    it('validates arguments before touching the page', async () => {
        const page = createPage([]);
        await expect(command().func(page, { listId: 'abc', limit: 10 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command().func(page, { listId: '123', limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.getCookies).not.toHaveBeenCalled();
    });

    it('requires a logged-in session', async () => {
        const page = createPage([], { cookies: [] });
        await expect(command().func(page, { listId: '123', limit: 10 })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('maps HTTP errors to typed errors', async () => {
        await expect(command().func(createPage([{ error: 403 }]), { listId: '123', limit: 10 })).rejects.toBeInstanceOf(AuthRequiredError);
        await expect(command().func(createPage([{ error: 404 }]), { listId: '123', limit: 10 })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('reports an inaccessible list and an empty list as empty results', async () => {
        await expect(command().func(createPage([{ data: {} }]), { listId: '123', limit: 10 })).rejects.toBeInstanceOf(EmptyResultError);
        await expect(command().func(createPage([membersPayload([], null)]), { listId: '123', limit: 10 })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('fails instead of truncating when a later page loses the timeline', async () => {
        const page = createPage([membersPayload(['alice'], 'cursor-1'), { data: {} }]);
        await expect(command().func(page, { listId: '123', limit: 10 })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
