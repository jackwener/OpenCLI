import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './comments.js';
import { walkPages } from './_shared/paging.js';

const id = '7697274002573872394';
const command = [...getRegistry().values()].find((c) => c.site === 'douyin' && c.name === 'comments');

function comment(cid, extra = {}) {
    return { cid, text: `text ${cid}`, digg_count: 1, reply_comment_total: 0, create_time: 1795416218, ip_label: '四川', user: { nickname: `u${cid}` }, ...extra };
}

/** Runs the real browser script with `fetch` answered by `route(url)`; records every URL. */
function pageFor(route) {
    const urls = [];
    return {
        urls,
        goto: vi.fn(),
        wait: vi.fn(),
        evaluate: async (script) => new Function('fetch', `return (${script})`)(async (url) => {
            urls.push(new URL(url));
            const body = route(new URL(url));
            return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 });
        }),
    };
}

/** Top-level pages: [c1 (2 replies), c2] then [c3]; replies of c1: [r1] then [r2]. */
function threadedSite() {
    return pageFor((url) => {
        const cursor = url.searchParams.get('cursor');
        if (url.pathname.endsWith('/comment/list/reply/')) {
            expect(url.searchParams.get('comment_id')).toBe('c1');
            return cursor === '0'
                ? { status_code: 0, comments: [comment('r1')], cursor: 1, has_more: 1 }
                : { status_code: 0, comments: [comment('r2')], cursor: 2, has_more: 0 };
        }
        expect(url.searchParams.get('aweme_id')).toBe(id);
        return cursor === '0'
            ? { status_code: 0, comments: [comment('c1', { reply_comment_total: 2 }), comment('c2')], cursor: 50, has_more: 1, total: 5 }
            : { status_code: 0, comments: [comment('c3'), comment('c2')], cursor: 100, has_more: 0, total: 5 };
    });
}

describe('douyin comments', () => {
    it('is a read-only cookie command on www.douyin.com with the documented columns', () => {
        expect(command).toMatchObject({ access: 'read', browser: true, domain: 'www.douyin.com' });
        expect(command.columns).toEqual(['rank', 'cid', 'parent_cid', 'user', 'text', 'likes', 'replies', 'time', 'ip_label', 'aweme_id']);
    });

    it('pages top-level comments to the end at 50 per page, de-duplicated, in China time', async () => {
        const page = threadedSite();
        const rows = await command.func(page, { target: `https://www.douyin.com/video/${id}`, limit: 100 });
        expect(rows.map((r) => r.cid)).toEqual(['c1', 'c2', 'c3']);
        expect(page.urls.map((u) => [u.searchParams.get('cursor'), u.searchParams.get('count')])).toEqual([['0', '50'], ['50', '50']]);
        expect(page.goto).toHaveBeenCalledWith(`https://www.douyin.com/video/${id}`);
        expect(rows[0]).toEqual({
            rank: 1, cid: 'c1', parent_cid: '', user: 'uc1', text: 'text c1', likes: 1, replies: 2,
            time: '2026-11-23 14:43:38', ip_label: '四川', aweme_id: id,
        });
        for (const row of rows) expect(Object.keys(row).sort()).toEqual([...command.columns].sort());
    });

    it('--replies pages each commented thread and nests replies under their parent', async () => {
        const page = threadedSite();
        const rows = await command.func(page, { target: id, limit: 100, replies: true });
        expect(rows.map((r) => [r.rank, r.cid, r.parent_cid, r.replies])).toEqual([
            [1, 'c1', '', 2], [2, 'r1', 'c1', null], [3, 'r2', 'c1', null], [4, 'c2', '', 0], [5, 'c3', '', 0],
        ]);
        expect(page.urls.filter((u) => u.pathname.endsWith('/reply/'))).toHaveLength(2);
    });

    it('--replies paces reply requests 5-10 s apart; top-level pages stay at 0.5 s', async () => {
        const page = threadedSite();
        await command.func(page, { target: id, limit: 100, replies: true });
        const waits = page.wait.mock.calls.map((c) => c[0].time);
        // goto settle, one top-level page gap, then before each reply request (2 pages in the c1 thread)
        expect(waits[0]).toBe(2.5);
        expect(waits[1]).toBe(0.5);
        const replyWaits = waits.slice(2);
        expect(replyWaits).toHaveLength(2);
        for (const w of replyWaits) {
            expect(w).toBeGreaterThanOrEqual(5);
            expect(w).toBeLessThanOrEqual(10);
        }
    });

    it('stops requesting once --limit rows are kept', async () => {
        const page = threadedSite();
        const rows = await command.func(page, { target: id, limit: 2, replies: true });
        expect(rows.map((r) => r.cid)).toEqual(['c1', 'c2']);
        expect(page.urls).toHaveLength(1);
    });

    it('stops when the cursor does not advance instead of looping', async () => {
        const page = pageFor(() => ({ status_code: 0, comments: [comment('c1')], cursor: 0, has_more: 1 }));
        const rows = await command.func(page, { target: id, limit: 100 });
        expect(rows).toHaveLength(1);
        expect(page.urls).toHaveLength(1);
    });

    it('reports a video without visible comments as an empty result', async () => {
        const page = pageFor(() => ({ status_code: 0, comments: null, cursor: 0, has_more: 0, total: 0 }));
        await expect(command.func(page, { target: id })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('fails typed on an unsigned/empty body and on a malformed list', async () => {
        await expect(command.func(pageFor(() => ''), { target: id })).rejects.toBeInstanceOf(CommandExecutionError);
        await expect(command.func(pageFor(() => ({ status_code: 0, comments: {} })), { target: id })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it.each([0, 20001, 1.5, 'x'])('rejects --limit %s before touching the page', async (limit) => {
        const page = threadedSite();
        await expect(command.func(page, { target: id, limit })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('rejects a non-Douyin target', async () => {
        await expect(command.func(threadedSite(), { target: 'https://evil.test/video/1' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('walkPages pauses between pages but not after the last one', async () => {
        const page = { wait: vi.fn() };
        const pages = [{ list: [1, 2], cursor: 2, has_more: 1 }, { list: [3], cursor: 3, has_more: 0 }];
        const seen = [];
        await walkPages(page, async (cursor) => pages[cursor === 0 ? 0 : 1], 'list', 10, (x) => seen.push(x));
        expect(seen).toEqual([1, 2, 3]);
        expect(page.wait).toHaveBeenCalledTimes(1);
    });
});
