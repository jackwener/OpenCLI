import { getRegistry } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { describe, expect, it, vi } from 'vitest';
import { __test__ } from './post.js';

// Mock browser page: render check returns true, getCookies reflects `cookie`,
// and successive content-item scrapes return the queued `pages`.
function makePage({ cookie = true, pages = [] }) {
    let idx = 0;
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        getCookies: vi.fn().mockResolvedValue(cookie ? [{ name: 'pjwt', value: 'x' }] : []),
        evaluate: vi.fn().mockImplementation(async (js) => {
            if (js.includes('__config__')) return true; // ensureNsHome render check
            return pages[idx++] ?? [];
        }),
    };
}

const floor = (n, id, content = `c${n}`) => ({ floor: String(n), comment_id: id, author: 'u', time: 't', content });

describe('nodeseek post', () => {
    it('extracts the post id from a post token even amid other numbers', () => {
        expect(__test__.parsePostId('779413')).toBe('779413');
        expect(__test__.parsePostId('post-779413-1')).toBe('779413');
        expect(__test__.parsePostId('https://www.nodeseek.com/post-779413-2#10704573')).toBe('779413');
        // Regression for the unanchored-regex bug: a /space or #frag number must not win.
        expect(__test__.parsePostId('https://www.nodeseek.com/space/12345#post-779413')).toBe('779413');
        expect(__test__.parsePostId('https://www.nodeseek.com/categories/123/post-779413-1')).toBe('779413');
    });

    it('rejects input without a post id', () => {
        expect(() => __test__.parsePostId('hello')).toThrow();
        expect(() => __test__.parsePostId('/space/6467')).toThrow();
    });

    it('validates limit within 1..500', () => {
        expect(__test__.readLimit(undefined)).toBe(20);
        expect(__test__.readLimit(500)).toBe(500);
        expect(() => __test__.readLimit(0)).toThrow();
        expect(() => __test__.readLimit(501)).toThrow();
        expect(() => __test__.readLimit(1.5)).toThrow();
    });

    it('dedupes by comment id and sorts by numeric floor', () => {
        const rows = __test__.dedupeAndSort([
            floor(0, 'a'), floor(42, 'b'), floor(2, 'c'), floor(42, 'b'), floor(15, 'd'),
        ], true);
        expect(rows.map((f) => f.floor)).toEqual(['0', '2', '15', '42']);
    });

    it('sorts blank/non-numeric floors after numbered ones', () => {
        const rows = __test__.dedupeAndSort([
            { floor: '', comment_id: 'x', author: 'u', time: 't', content: 'blank' },
            floor(1, 'a'),
        ], true);
        expect(rows.map((f) => f.floor)).toEqual(['1', '']);
    });

    it('truncates floor content to 200 chars by default, keeps full when asked', () => {
        const one = [floor(0, '1', 'x'.repeat(500))];
        expect(__test__.dedupeAndSort(one, false)[0].content).toHaveLength(201);
        expect(__test__.dedupeAndSort(one, true)[0].content).toHaveLength(500);
    });

    const command = getRegistry().get('nodeseek/post');

    it('walks pages to the limit and dedupes across page boundaries', async () => {
        const p1 = [floor(0, 'a'), floor(1, 'b')];
        const p2 = [floor(1, 'b'), floor(2, 'c')]; // boundary dup of comment b
        const rows = await command.func(makePage({ pages: [p1, p2, []] }), { id: '779413', limit: 3 });
        expect(rows.map((f) => f.floor)).toEqual(['0', '1', '2']);
    });

    it('throws AuthRequiredError when not logged in', async () => {
        await expect(command.func(makePage({ cookie: false, pages: [] }), { id: '779413', limit: 20 }))
            .rejects.toThrow(/login/i);
    });

    it('throws EmptyResultError when the thread has no floors', async () => {
        await expect(command.func(makePage({ pages: [[]] }), { id: '779413', limit: 20 }))
            .rejects.toThrow(EmptyResultError);
    });
});
