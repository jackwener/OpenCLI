import { describe, expect, it } from 'vitest';
import { finalizeListRows, readLimit } from './client.js';

describe('nodeseek client.readLimit', () => {
    it('defaults to 20 and accepts in-range integers', () => {
        expect(readLimit(undefined, { max: 100 })).toBe(20);
        expect(readLimit(50, { max: 100 })).toBe(50);
        expect(readLimit(100, { max: 100 })).toBe(100);
    });

    it('rejects zero, negatives, over-max, and non-integers', () => {
        expect(() => readLimit(0, { max: 100 })).toThrow();
        expect(() => readLimit(-5, { max: 100 })).toThrow();
        expect(() => readLimit(101, { max: 100 })).toThrow();
        expect(() => readLimit(2.5, { max: 100 })).toThrow();
    });
});

describe('nodeseek client.finalizeListRows', () => {
    it('builds rows, drops incomplete ones, and honors limit', () => {
        const rows = finalizeListRows([
            { post_id: '686001', title: '[测试留档]Kamatera NY 1C1G', category: '测评', author: 'vono', time: 't', link: 'https://www.nodeseek.com/post-686001-1' },
            { post_id: '', title: 'no id', link: '/x' },
            { post_id: '3', title: '', link: '/y' },
        ], 20);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ post_id: '686001', author: 'vono' });
    });

    it('dedupes by post_id (paginated feeds repeat boundary rows)', () => {
        const rows = finalizeListRows([
            { post_id: '1', title: 'a' },
            { post_id: '1', title: 'a' },
            { post_id: '2', title: 'b' },
        ], 20);
        expect(rows.map((r) => r.post_id)).toEqual(['1', '2']);
    });

    it('caps at limit', () => {
        const many = Array.from({ length: 10 }, (_, i) => ({ post_id: String(i), title: `t${i}` }));
        expect(finalizeListRows(many, 3)).toHaveLength(3);
    });
});
