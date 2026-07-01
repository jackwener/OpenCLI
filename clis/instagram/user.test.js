import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './user.js';
import { createPageMock } from '../test-utils.js';
function makeProfileResponse() {
    return {
        ok: true,
        status: 200,
        data: {
            data: {
                user: {
                    id: '111222333',
                },
            },
        },
    };
}
function makeFeedPage(hasMore, nextMaxId = '', items = []) {
    return {
        ok: true,
        status: 200,
        data: {
            items,
            more_available: hasMore,
            next_max_id: nextMaxId,
        },
    };
}
function postItem(overrides = {}) {
    return {
        id: 'post-1',
        code: 'C123',
        media_type: 1,
        caption: { text: 'Hello' },
        like_count: 10,
        comment_count: 3,
        taken_at: 1718016000,
        is_reel_media: false,
        product_type: 'feed',
        ...overrides,
    };
}
describe('instagram user command registration', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });
    it('registers user command with URL and identifier columns', () => {
        const cmd = getRegistry().get('instagram/user');
        expect(cmd).toBeDefined();
        expect(cmd?.columns).toContain('url');
        expect(cmd?.columns).toContain('shortcode');
        expect(cmd?.columns).toContain('media_id');
        expect(cmd?.columns).toContain('kind');
        expect(cmd?.columns).toContain('posted_at');
        expect(cmd?.columns).toContain('caption');
        const limitArg = cmd?.args?.find((arg) => arg.name === 'limit');
        expect(limitArg?.help).toContain('1-');
        const dateArg = cmd?.args?.find((arg) => arg.name === 'date');
        expect(dateArg?.help).toContain('YYYY-MM-DD');
        const fromArg = cmd?.args?.find((arg) => arg.name === 'from');
        expect(fromArg?.help).toContain('ISO 8601');
        const captionArg = cmd?.args?.find((arg) => arg.name === 'caption-filter');
        expect(captionArg?.help).toContain('Keep only posts');
    });
    it('rejects non-positive or oversized --limit before browser work', async () => {
        const page = createPageMock();
        const cmd = getRegistry().get('instagram/user');
        await expect(cmd.func(page, { username: 'devtalksbusiness', limit: 0 })).rejects.toThrow(ArgumentError);
        await expect(cmd.func(page, { username: 'devtalksbusiness', limit: 1001 })).rejects.toThrow(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });
    it('collects posts across paginated pages and dedupes by shortcode', async () => {
        const page = createPageMock([
            makeProfileResponse(),
            makeFeedPage(true, 'next-page', [
                postItem({ id: 'id-1', code: 'ABC1', media_type: 2, caption: { text: 'ep 1' }, is_reel_media: true }),
                postItem({ id: 'id-2', code: 'ABC2', media_type: 1, caption: { text: 'ep 2' } }),
            ]),
            makeFeedPage(false, '', [
                postItem({ id: 'id-2', code: 'ABC2', media_type: 8, caption: { text: 'dup ep 2' } }),
                postItem({ id: 'id-3', code: 'ABC3', media_type: 1, caption: { text: 'ep 3' }, taken_at: 1718016001, product_type: 'clips' }),
            ]),
        ]);
        const cmd = getRegistry().get('instagram/user');
        const rows = await cmd.func(page, { username: 'devtalksbusiness', limit: 10 });
        const calls = page.evaluate.mock.calls;
        expect(calls[0][1]).toMatch(/\/api\/v1\/users\/web_profile_info\/\?username=devtalksbusiness/);
        expect(calls[1][1]).toMatch(/\/api\/v1\/feed\/user\/111222333\/\?count=10$/);
        expect(calls[2][1]).toMatch(/\/api\/v1\/feed\/user\/111222333\/\?count=8&max_id=next-page$/);
        expect(rows.map((row) => row.shortcode)).toEqual(['ABC1', 'ABC2', 'ABC3']);
        expect(rows[0]).toMatchObject({ url: 'https://www.instagram.com/reel/ABC1/', kind: 'reel', shortcode: 'ABC1', media_id: 'id-1' });
        expect(rows[0].posted_at).toBe(new Date(1718016000 * 1000).toISOString());
        expect(rows[2]).toMatchObject({ url: 'https://www.instagram.com/reel/ABC3/', kind: 'reel' });
        expect(page.evaluate).toHaveBeenCalledTimes(3);
    });
    it('filters to one full local day with --date', async () => {
        const page = createPageMock([
            makeProfileResponse(),
            makeFeedPage(false, '', [
                postItem({ id: 'id-1', code: 'D1', taken_at: Math.floor(new Date('2026-07-11T00:10:00').getTime() / 1000) }),
                postItem({ id: 'id-2', code: 'D2', taken_at: Math.floor(new Date('2026-07-11T18:30:00').getTime() / 1000) }),
                postItem({ id: 'id-3', code: 'D3', taken_at: Math.floor(new Date('2026-07-12T00:05:00').getTime() / 1000) }),
            ]),
        ]);
        const cmd = getRegistry().get('instagram/user');
        const rows = await cmd.func(page, { username: 'devtalksbusiness', limit: 10, date: '2026-07-11' });
        expect(rows.map((row) => row.shortcode)).toEqual(['D1', 'D2']);
    });
    it('filters to an exact timestamp window with --from and --to', async () => {
        const page = createPageMock([
            makeProfileResponse(),
            makeFeedPage(true, 'next-page', [
                postItem({ id: 'id-1', code: 'T1', taken_at: Math.floor(new Date('2026-07-12T19:00:00+05:30').getTime() / 1000) }),
                postItem({ id: 'id-2', code: 'T2', taken_at: Math.floor(new Date('2026-07-12T18:15:00+05:30').getTime() / 1000) }),
                postItem({ id: 'id-3', code: 'T3', taken_at: Math.floor(new Date('2026-07-11T19:00:00+05:30').getTime() / 1000) }),
                postItem({ id: 'id-4', code: 'T4', taken_at: Math.floor(new Date('2026-07-11T17:00:00+05:30').getTime() / 1000) }),
            ]),
            makeFeedPage(false, '', [
                postItem({ id: 'id-5', code: 'T5', taken_at: Math.floor(new Date('2026-07-11T16:00:00+05:30').getTime() / 1000) }),
            ]),
        ]);
        const cmd = getRegistry().get('instagram/user');
        const rows = await cmd.func(page, {
            username: 'devtalksbusiness',
            limit: 10,
            from: '2026-07-11T18:30:00+05:30',
            to: '2026-07-12T18:30:00+05:30',
        });
        expect(rows.map((row) => row.shortcode)).toEqual(['T2', 'T3']);
        expect(page.evaluate).toHaveBeenCalledTimes(2);
    });
    it('accepts unix timestamp windows and stops paging after the lower bound', async () => {
        const from = Math.floor(new Date('2026-07-11T18:30:00+05:30').getTime() / 1000);
        const to = Math.floor(new Date('2026-07-12T18:30:00+05:30').getTime() / 1000);
        const page = createPageMock([
            makeProfileResponse(),
            makeFeedPage(true, 'next-page', [
                postItem({ id: 'id-1', code: 'U1', taken_at: to + 60 }),
                postItem({ id: 'id-2', code: 'U2', taken_at: to - 60 }),
                postItem({ id: 'id-3', code: 'U3', taken_at: from - 60 }),
            ]),
        ]);
        const cmd = getRegistry().get('instagram/user');
        const rows = await cmd.func(page, {
            username: 'devtalksbusiness',
            limit: 10,
            from: String(from),
            to: String(to),
        });
        expect(rows.map((row) => row.shortcode)).toEqual(['U2']);
        expect(page.evaluate).toHaveBeenCalledTimes(2);
    });
    it('stops fetching once requested limit is reached', async () => {
        const page = createPageMock([
            makeProfileResponse(),
            makeFeedPage(false, '', [
                postItem({ id: 'id-1', code: 'A1' }),
                postItem({ id: 'id-2', code: 'A2' }),
                postItem({ id: 'id-3', code: 'A3' }),
            ]),
        ]);
        const cmd = getRegistry().get('instagram/user');
        const rows = await cmd.func(page, { username: 'devtalksbusiness', limit: 2 });
        expect(rows).toHaveLength(2);
        expect(rows.map((row) => row.shortcode)).toEqual(['A1', 'A2']);
        expect(page.evaluate).toHaveBeenCalledTimes(2);
    });
    it('filters captions with case-insensitive contains by default', async () => {
        const page = createPageMock([
            makeProfileResponse(),
            makeFeedPage(false, '', [
                postItem({ id: 'id-1', code: 'A1', caption: { text: 'This is Making You Financially Independent 01' } }),
                postItem({ id: 'id-2', code: 'A2', caption: { text: 'random post' } }),
                postItem({ id: 'id-3', code: 'A3', caption: { text: 'MAKING YOU FINANCIALLY INDEPENDENT 03' } }),
                postItem({ id: 'id-4', code: 'A4', caption: { text: 'another clip' } }),
            ]),
        ]);
        const cmd = getRegistry().get('instagram/user');
        const rows = await cmd.func(page, {
            username: 'devtalksbusiness',
            limit: 10,
            'caption-filter': 'making you financially independent',
        });
        expect(rows.map((row) => row.shortcode)).toEqual(['A1', 'A3']);
    });
    it('supports case-sensitive mode and explicit reject pattern', async () => {
        const page = createPageMock([
            makeProfileResponse(),
            makeFeedPage(false, '', [
                postItem({ id: 'id-1', code: 'A1', caption: { text: 'Making you financially independent - day 01' } }),
                postItem({ id: 'id-2', code: 'A2', caption: { text: 'making you financially independent - day 02' } }),
                postItem({ id: 'id-3', code: 'A3', caption: { text: 'Making you financially independent - day 03' } }),
            ]),
        ]);
        const cmd = getRegistry().get('instagram/user');
        const rows = await cmd.func(page, {
            username: 'devtalksbusiness',
            limit: 10,
            'caption-filter': 'Making you financially independent',
            'caption-filter-mode': 'contains',
            'caption-case-sensitive': true,
            'caption-reject': 'day 01',
        });
        expect(rows.map((row) => row.shortcode)).toEqual(['A3']);
    });
    it('supports regex mode with case-insensitive default', async () => {
        const page = createPageMock([
            makeProfileResponse(),
            makeFeedPage(false, '', [
                postItem({ id: 'id-1', code: 'A1', caption: { text: 'deals #financially' } }),
                postItem({ id: 'id-2', code: 'A2', caption: { text: 'financially independent' } }),
                postItem({ id: 'id-3', code: 'A3', caption: { text: 'finance daily' } }),
            ]),
        ]);
        const cmd = getRegistry().get('instagram/user');
        const rows = await cmd.func(page, {
            username: 'devtalksbusiness',
            limit: 10,
            'caption-filter-mode': 'regex',
            'caption-filter': 'financially\\s+independent',
            'caption-reject': 'finance daily',
        });
        expect(rows.map((row) => row.shortcode)).toEqual(['A2']);
    });
    it('rejects invalid or conflicting time-window arguments before browser work', async () => {
        const page = createPageMock();
        const cmd = getRegistry().get('instagram/user');
        await expect(cmd.func(page, {
            username: 'devtalksbusiness',
            date: '11 July 2026',
            limit: 10,
        })).rejects.toThrow(ArgumentError);
        await expect(cmd.func(page, {
            username: 'devtalksbusiness',
            from: '2026-07-11T18:30:00+05:30',
            limit: 10,
            date: '2026-07-11',
        })).rejects.toThrow(ArgumentError);
        await expect(cmd.func(page, {
            username: 'devtalksbusiness',
            to: '2026-07-12T18:30:00+05:30',
            limit: 10,
        })).rejects.toThrow(ArgumentError);
        expect(page.evaluate).not.toHaveBeenCalled();
    });
    it('throws for invalid regex patterns before fetching the feed', async () => {
        const page = createPageMock([makeProfileResponse()]);
        const cmd = getRegistry().get('instagram/user');
        await expect(cmd.func(page, {
            username: 'devtalksbusiness',
            'caption-filter-mode': 'regex',
            'caption-filter': '[',
            limit: 10,
        })).rejects.toThrow(ArgumentError);
        expect(page.evaluate).not.toHaveBeenCalled();
    });
    it('throws a clear error when user cannot be found', async () => {
        const page = createPageMock([
            {
                ok: true,
                status: 200,
                data: { data: { user: null } },
            },
        ]);
        const cmd = getRegistry().get('instagram/user');
        await expect(cmd.func(page, { username: 'missing_account', limit: 1 }))
            .rejects.toThrow(CommandExecutionError);
    });
    it('throws EmptyResultError when the profile has no posts in feed', async () => {
        const page = createPageMock([
            makeProfileResponse(),
            makeFeedPage(false, '', []),
        ]);
        const cmd = getRegistry().get('instagram/user');
        await expect(cmd.func(page, { username: 'devtalksbusiness', limit: 1 }))
            .rejects.toThrow(EmptyResultError);
    });
});
