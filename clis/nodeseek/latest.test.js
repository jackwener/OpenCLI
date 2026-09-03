import { getRegistry } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { describe, expect, it, vi } from 'vitest';
import { __test__ } from './latest.js';

function makePage({ rendered = true, pages = [] }) {
    let idx = 0;
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockImplementation(async (js) => {
            if (js.includes('__config__')) return rendered; // ensureNsHome render check
            return pages[idx++] ?? [];
        }),
    };
}
const listRow = (i) => ({ post_id: String(i), title: `t${i}`, category: 'c', author: 'a', time: 't', link: `/post-${i}-1` });

describe('nodeseek latest', () => {
    it('validates limit within 1..100', () => {
        expect(__test__.readLimit(undefined)).toBe(20);
        expect(__test__.readLimit(100)).toBe(100);
        expect(() => __test__.readLimit(0)).toThrow();
        expect(() => __test__.readLimit(101)).toThrow();
    });

    it('resolves a known board and rejects an unknown one', () => {
        expect(__test__.resolveBoard('')).toEqual({ isCategory: false });
        expect(__test__.resolveBoard('TECH')).toEqual({ isCategory: true, slug: 'tech' });
        expect(() => __test__.resolveBoard('nope')).toThrow();
    });

    it('builds home and category page URLs', () => {
        const home = { isCategory: false };
        const tech = { isCategory: true, slug: 'tech' };
        expect(__test__.pageUrl(home, 1)).toBe('https://www.nodeseek.com/');
        expect(__test__.pageUrl(home, 3)).toBe('https://www.nodeseek.com/page-3');
        expect(__test__.pageUrl(tech, 1)).toBe('https://www.nodeseek.com/categories/tech');
        expect(__test__.pageUrl(tech, 2)).toBe('https://www.nodeseek.com/categories/tech?page=2');
    });

    it('exposes the known board slugs', () => {
        expect(__test__.CATEGORIES).toContain('daily');
        expect(__test__.CATEGORIES).toContain('photo-share');
        expect(__test__.CATEGORIES).toHaveLength(13);
    });

    it('registers latest as a public browser command', () => {
        const command = getRegistry().get('nodeseek/latest');
        expect(command?.strategy).toBe('public');
        expect(command?.browser).toBe(true);
        expect(command?.columns).toEqual(['post_id', 'title', 'category', 'author', 'time', 'link']);
    });

    const command = getRegistry().get('nodeseek/latest');

    it('collects posts up to the limit', async () => {
        const page1 = Array.from({ length: 50 }, (_, i) => listRow(i));
        const rows = await command.func(makePage({ pages: [page1] }), { category: '', limit: 20 });
        expect(rows).toHaveLength(20);
    });

    it('throws when NodeSeek did not render (Cloudflare interstitial)', async () => {
        await expect(command.func(makePage({ rendered: false, pages: [] }), { category: '', limit: 5 }))
            .rejects.toThrow(/render|Cloudflare/i);
    });

    it('throws EmptyResultError when the board is empty', async () => {
        await expect(command.func(makePage({ pages: [[]] }), { category: '', limit: 5 }))
            .rejects.toThrow(EmptyResultError);
    });
});
