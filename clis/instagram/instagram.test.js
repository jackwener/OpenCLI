import { describe, expect, it, vi } from 'vitest';
import './following.js';
import { getRegistry } from '@jackwener/opencli/registry';

/**
 * Extract the evaluate JS source from the following command pipeline
 * so we can test the pagination logic in-process via eval().
 */
function getFollowingEvaluateJs() {
    const cmd = getRegistry().get('instagram/following');
    const evalStep = cmd.pipeline.find((s) => s.evaluate);
    return evalStep.evaluate;
}

/**
 * Run the following evaluate script with a mock fetch in global scope.
 * Returns the resolved value.
 */
async function runFollowingEvaluate(fetchFn, args = { username: 'testuser', limit: 20 }) {
    const jsTemplate = getFollowingEvaluateJs();
    // Replace the template placeholders with actual values
    const js = jsTemplate
        .replace('${{ args.username | json }}', JSON.stringify(args.username))
        .replace('${{ args.limit }}', String(args.limit));

    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchFn;
    try {
        return await eval(js);
    } finally {
        globalThis.fetch = originalFetch;
    }
}

/**
 * Build a single-page Instagram following API response.
 */
function buildFollowingResponse(users, nextMaxId = null, hasMore = undefined) {
    return {
        users,
        next_max_id: nextMaxId,
        ...(hasMore === undefined ? {} : { has_more: hasMore }),
    };
}

/**
 * Build a user object with a given pk and username.
 */
function makeUser(pk, username = null) {
    return {
        pk,
        pk_id: String(pk),
        username: username || ('user_' + pk),
        full_name: 'User ' + pk,
        is_verified: pk % 2 === 0,
        is_private: pk % 3 === 0,
    };
}

describe('instagram/following pagination', () => {
    it('returns a single page when results fit within one request', async () => {
        const users = Array.from({ length: 10 }, (_, i) => makeUser(1000 + i));
        const fetchFn = vi.fn()
            // First call: profile info
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ data: { user: { id: '12345' } } }),
            })
            // Second call: following page (no next_max_id)
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(buildFollowingResponse(users)),
            });

        const result = await runFollowingEvaluate(fetchFn, { username: 'alice', limit: 20 });

        expect(result).toHaveLength(10);
        expect(result[0]).toEqual({
            rank: 1,
            username: 'user_1000',
            name: 'User 1000',
            verified: 'Yes',
            private: 'No',
        });
        expect(result[9].rank).toBe(10);
        // Only 2 fetch calls total (profile + 1 following page)
        expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('paginates across multiple pages via next_max_id cursor', async () => {
        const page1Users = Array.from({ length: 50 }, (_, i) => makeUser(1000 + i));
        const page2Users = Array.from({ length: 50 }, (_, i) => makeUser(2000 + i));
        const page3Users = Array.from({ length: 20 }, (_, i) => makeUser(3000 + i));

        const fetchFn = vi.fn()
            // Profile info
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ data: { user: { id: '99999' } } }),
            })
            // Page 1: 50 users, has next_max_id
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(buildFollowingResponse(page1Users, 'max_cursor_1')),
            })
            // Page 2: 50 users, has next_max_id
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(buildFollowingResponse(page2Users, 'max_cursor_2')),
            })
            // Page 3: 20 users, no next_max_id
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(buildFollowingResponse(page3Users)),
            });

        const result = await runFollowingEvaluate(fetchFn, { username: 'bob', limit: 120 });

        expect(result).toHaveLength(120);
        // Ranks should be sequential across pages
        expect(result[0].rank).toBe(1);
        expect(result[49].rank).toBe(50);
        expect(result[50].rank).toBe(51);
        expect(result[119].rank).toBe(120);
        // 4 fetch calls: profile + 3 pages
        expect(fetchFn).toHaveBeenCalledTimes(4);
    });

    it('deduplicates users by pk when cursor overlaps', async () => {
        const sharedUser = makeUser(1000, 'shared_user');
        const page1Users = [sharedUser, makeUser(1001), makeUser(1002)];
        const page2Users = [sharedUser, makeUser(1003), makeUser(1004)];

        const fetchFn = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ data: { user: { id: '55555' } } }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(buildFollowingResponse(page1Users, 'cursor_overlap')),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(buildFollowingResponse(page2Users)),
            });

        const result = await runFollowingEvaluate(fetchFn, { username: 'carol', limit: 20 });

        // 5 unique users total (shared_user counted once)
        expect(result).toHaveLength(5);
        expect(result.map((r) => r.username)).toEqual([
            'shared_user', 'user_1001', 'user_1002', 'user_1003', 'user_1004',
        ]);
    });

    it('respects the limit and stops early even with more data available', async () => {
        const users = Array.from({ length: 50 }, (_, i) => makeUser(1000 + i));

        const fetchFn = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ data: { user: { id: '77777' } } }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(buildFollowingResponse(users, 'more_available')),
            });

        const result = await runFollowingEvaluate(fetchFn, { username: 'dave', limit: 5 });

        expect(result).toHaveLength(5);
        expect(result[4].rank).toBe(5);
        // Should NOT have fetched a second following page
        expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('honors explicit has_more=false even if a cursor is present', async () => {
        const users = Array.from({ length: 50 }, (_, i) => makeUser(1000 + i));

        const fetchFn = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ data: { user: { id: '77778' } } }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(buildFollowingResponse(users, 'stale_cursor', false)),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(buildFollowingResponse(Array.from({ length: 50 }, (_, i) => makeUser(2000 + i)))),
            });

        const result = await runFollowingEvaluate(fetchFn, { username: 'done', limit: 200 });

        expect(result).toHaveLength(50);
        expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('handles empty following list gracefully', async () => {
        const fetchFn = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ data: { user: { id: '88888' } } }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(buildFollowingResponse([])),
            });

        const result = await runFollowingEvaluate(fetchFn, { username: 'empty_user', limit: 20 });

        expect(result).toEqual([]);
        expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('breaks when next_max_id repeats (cursor loop guard)', async () => {
        const page1Users = Array.from({ length: 50 }, (_, i) => makeUser(1000 + i));
        const page2Users = Array.from({ length: 50 }, (_, i) => makeUser(2000 + i));

        const fetchFn = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ data: { user: { id: '44444' } } }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(buildFollowingResponse(page1Users, 'cursor_loop')),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(buildFollowingResponse(page2Users, 'cursor_loop')),
            })
            // If guard fails this would be reached and trigger the assertion below.
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(buildFollowingResponse(page2Users, 'cursor_loop')),
            });

        const result = await runFollowingEvaluate(fetchFn, { username: 'loopy', limit: 500 });

        expect(result).toHaveLength(100);
        // Profile + page1 + page2 = 3 calls; cursor loop guard prevents the 4th.
        expect(fetchFn).toHaveBeenCalledTimes(3);
    });

    it('breaks when a page yields zero new unique users', async () => {
        const page1Users = Array.from({ length: 50 }, (_, i) => makeUser(1000 + i));
        // Page 2 returns the same users with a fresh cursor — dedupe leaves nothing new.
        const page2Users = [...page1Users];

        const fetchFn = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ data: { user: { id: '33333' } } }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(buildFollowingResponse(page1Users, 'cursor_a')),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(buildFollowingResponse(page2Users, 'cursor_b')),
            });

        const result = await runFollowingEvaluate(fetchFn, { username: 'stuck', limit: 500 });

        expect(result).toHaveLength(50);
        // Profile + 2 following pages, then stop on zero-growth detection.
        expect(fetchFn).toHaveBeenCalledTimes(3);
    });

    it('rejects non-positive limits before fetching', async () => {
        const fetchFn = vi.fn();

        await expect(
            runFollowingEvaluate(fetchFn, { username: 'noop', limit: 0 }),
        ).rejects.toThrow('limit must be a positive integer');
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it('propagates HTTP errors that occur on a mid-pagination page', async () => {
        const page1Users = Array.from({ length: 50 }, (_, i) => makeUser(1000 + i));

        const fetchFn = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ data: { user: { id: '11111' } } }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(buildFollowingResponse(page1Users, 'next')),
            })
            .mockResolvedValueOnce({ ok: false, status: 429 });

        await expect(
            runFollowingEvaluate(fetchFn, { username: 'broken', limit: 200 }),
        ).rejects.toThrow('Failed to fetch following: HTTP 429');
    });

    it('typed-fails malformed following payloads instead of returning empty rows', async () => {
        const fetchFn = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ data: { user: { id: '10101' } } }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ users: null }),
            });

        await expect(
            runFollowingEvaluate(fetchFn, { username: 'malformed', limit: 20 }),
        ).rejects.toThrow('Instagram following returned malformed users payload');
    });

    it('typed-fails malformed user identity rows instead of emitting blank usernames', async () => {
        const fetchFn = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ data: { user: { id: '10102' } } }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(buildFollowingResponse([{ pk: '1', full_name: 'No username' }])),
            });

        await expect(
            runFollowingEvaluate(fetchFn, { username: 'badrow', limit: 20 }),
        ).rejects.toThrow('Instagram following returned malformed user row');
    });

    it('typed-fails malformed pagination cursors', async () => {
        const fetchFn = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ data: { user: { id: '10103' } } }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(buildFollowingResponse([makeUser(1)], { cursor: 'bad' })),
            });

        await expect(
            runFollowingEvaluate(fetchFn, { username: 'badcursor', limit: 20 }),
        ).rejects.toThrow('Instagram following returned malformed pagination cursor');
    });

    it('typed-fails has_more=true without a pagination cursor', async () => {
        const fetchFn = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ data: { user: { id: '10104' } } }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(buildFollowingResponse([makeUser(1)], null, true)),
            });

        await expect(
            runFollowingEvaluate(fetchFn, { username: 'missingcursor', limit: 20 }),
        ).rejects.toThrow('Instagram following returned has_more without pagination cursor');
    });

    it('typed-fails malformed has_more flags', async () => {
        const fetchFn = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ data: { user: { id: '10105' } } }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(buildFollowingResponse([makeUser(1)], 'next', 'yes')),
            });

        await expect(
            runFollowingEvaluate(fetchFn, { username: 'badhasmore', limit: 20 }),
        ).rejects.toThrow('Instagram following returned malformed has_more flag');
    });
});
