import { describe, expect, it, vi } from 'vitest';
import { collectHistory, parseHistoryOptions } from './private-messages.js';
const row = id => ({ message_id: String(id), orderKey: String(id) });
const collect = (pages, args = {}) => collectHistory({
    label: 'test incremental', options: parseHistoryOptions({ 'after-message': '2', ...args }), cursor: '9',
    fetchPage: vi.fn(() => pages.shift()), project: item => item, pause: vi.fn(),
});

describe('exact message watermark incremental reads', () => {
    it('traverses past a recent limit until the checkpoint is found, then returns oldest new N', async () => {
        const pages = [
            { items: [row(9), row(8)], hasMore: true, nextCursor: '7' },
            { items: [row(7), row(6), row(5), row(4), row(3), row(2), row(1)], hasMore: true, nextCursor: '0' },
        ];
        expect((await collect(pages, { limit: 2 })).map(item => item.message_id)).toEqual(['3', '4']);
        expect(pages).toHaveLength(0);
    });
    it('returns all new messages by default, in chronological server position order', async () => {
        expect((await collect([{ items: [row(5), row(2), row(4), row(3), row(1)], hasMore: false }])).map(item => item.message_id)).toEqual(['3', '4', '5']);
    });
    it('returns an empty successful delta only after finding the exact checkpoint', async () => {
        expect(await collect([{ items: [row(2), row(1)], hasMore: false }])).toEqual([]);
    });
    it('fails on a missing checkpoint, including completely empty history', async () => {
        await expect(collect([{ items: [row(5), row(1)], hasMore: false }])).rejects.toThrow('possible gap');
        await expect(collect([{ items: [], hasMore: false }])).rejects.toThrow('possible gap');
    });
    it('never reports a truncated delta as complete on a page safety bound', async () => {
        await expect(collect([{ items: [row(9), row(8)], hasMore: true, nextCursor: '7' }], { limit: 1, 'max-pages': 1 })).rejects.toThrow('--max-pages');
    });
    it('rejects empty, oversized, whitespace and conflicting checkpoint arguments', () => {
        for (const value of ['', ' ', 'message one', 'a'.repeat(257)]) expect(() => parseHistoryOptions({ 'after-message': value })).toThrow('--after-message');
        expect(() => parseHistoryOptions({ 'after-message': '2', all: true })).toThrow('--after-message and --all');
    });
});
