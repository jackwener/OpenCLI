import { describe, expect, it, vi } from 'vitest';
import { collectHistory, contentObject, parseHistoryOptions, positiveInteger, requireObject } from './private-messages.js';

const row = (id, position = id) => ({ message_id: String(id), orderKey: String(position), created_at: '2026-01-01T00:00:00.000Z' });
const options = { all: true, limit: 50, maxPages: 10, timeout: 120 };
const collect = (pages, overrides = {}) => collectHistory({
    label: 'test messages', options, cursor: '3', fetchPage: vi.fn().mockImplementation(() => pages.shift()),
    project: item => item, pause: vi.fn().mockResolvedValue(), ...overrides,
});

describe('private messaging arguments', () => {
    it('defaults to recent 50 and bounded history requests', () => {
        expect(parseHistoryOptions({})).toEqual({ all: false, limit: 50, maxPages: 200, timeout: 120 });
    });
    it('allows all only without an explicit limit', () => {
        expect(parseHistoryOptions({ all: true }).all).toBe(true);
        expect(() => parseHistoryOptions({ all: true, limit: 10 })).toThrow('--all and --limit');
    });
    it.each([0, -1, 1.5, 10001, NaN, Infinity, '', true, 'bad'])('rejects invalid limit %s', value => {
        expect(() => positiveInteger(value, 50, 10000, '--limit')).toThrow();
    });
    it('rejects invalid page and timeout bounds', () => {
        expect(() => parseHistoryOptions({ 'max-pages': 2001 })).toThrow('--max-pages');
        expect(() => parseHistoryOptions({ timeout: 3601 })).toThrow('--timeout');
    });
    it('unwraps session payloads but rejects nulls and arrays', () => {
        expect(requireObject({ session: 'test', data: { ok: true } }, 'test')).toEqual({ ok: true });
        expect(() => requireObject([], 'test')).toThrow('malformed');
        expect(() => requireObject(null, 'test')).toThrow('malformed');
        expect(() => contentObject('not JSON', 'test')).toThrow('invalid');
    });
});

describe('private history collection', () => {
    it('deduplicates and orders by server conversation position, not clock skew or ID spelling', async () => {
        const rows = await collect([
            { items: [row('9', '9007199254741002'), row('10', '9007199254741001')], hasMore: true, nextCursor: '2' },
            { items: [row('10', '9007199254741001'), { ...row('2', '9007199254741000'), created_at: '2030-01-01T00:00:00.000Z' }], hasMore: false },
        ]);
        expect(rows.map(item => item.message_id)).toEqual(['2', '10', '9']);
        expect(rows.map(item => item.index)).toEqual([1, 2, 3]);
        expect(rows.every(item => !('orderKey' in item))).toBe(true);
    });
    it('takes the newest N, in chronological conversation order, without fetching older pages', async () => {
        const fetchPage = vi.fn().mockResolvedValue({ items: [row(1), row(3), row(2)], hasMore: true, nextCursor: '2' });
        const rows = await collect([], { options: { ...options, all: false, limit: 2 }, fetchPage });
        expect(rows.map(item => item.message_id)).toEqual(['2', '3']);
        expect(fetchPage).toHaveBeenCalledTimes(1);
    });
    it('returns fewer than N only when the server confirms history end', async () => {
        expect(await collect([{ items: [row(1)], hasMore: false }], { options: { ...options, all: false } })).toHaveLength(1);
    });
    it('skips explicitly invisible SDK control records', async () => {
        const rows = await collect([{ items: [row(1), null], hasMore: false }]);
        expect(rows).toHaveLength(1);
    });
    it.each([
        { pages: [{ items: [], hasMore: true, nextCursor: '2' }] },
        { pages: [{ items: [row(3)], hasMore: true, nextCursor: '3' }] },
        { pages: [{ items: [row(3)], hasMore: true, nextCursor: '2' }, { items: [row(2)], hasMore: true, nextCursor: '3' }] },
    ])('rejects pagination stalls instead of returning partial --all', async ({ pages }) => {
        await expect(collect(pages)).rejects.toThrow(/stalled|repeated/);
    });
    it('fails at the safety bound', async () => {
        await expect(collect([{ items: [row(3)], hasMore: true, nextCursor: '2' }], { options: { ...options, maxPages: 1 } })).rejects.toThrow('--max-pages');
    });
    it('fails on missing completion flags and conflicting message IDs', async () => {
        await expect(collect([{ items: [row(3)] }])).rejects.toThrow('malformed');
        await expect(collect([{ items: [row(3), row(3, 2)], hasMore: false }])).rejects.toThrow('conflicting');
    });
    it('reports empty history explicitly', async () => {
        await expect(collect([{ items: [], hasMore: false }])).rejects.toMatchObject({ code: 'EMPTY_RESULT' });
    });
    it('stops after a slow request without requesting more pages', async () => {
        const now = vi.spyOn(Date, 'now');
        now.mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(1001);
        try {
            const fetchPage = vi.fn().mockResolvedValue({ items: [row(3)], hasMore: true, nextCursor: '2' });
            await expect(collect([], { options: { ...options, timeout: 1 }, fetchPage })).rejects.toMatchObject({ code: 'TIMEOUT' });
            expect(fetchPage).toHaveBeenCalledTimes(1);
        } finally { now.mockRestore(); }
    });
});
