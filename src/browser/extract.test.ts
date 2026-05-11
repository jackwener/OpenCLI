import { describe, expect, it } from 'vitest';
import { buildExtractHtmlJs, chunkMarkdown, runExtractFromHtml } from './extract.js';

describe('chunkMarkdown', () => {
    it('returns the full content when it fits in one chunk', () => {
        const content = 'short body';
        const r = chunkMarkdown({ content, start: 0, chunkSize: 20000 });
        expect(r.content).toBe(content);
        expect(r.start).toBe(0);
        expect(r.end).toBe(content.length);
        expect(r.nextStartChar).toBeNull();
    });

    it('emits next_start_char when more content remains', () => {
        // Build content long enough that chunkSize cuts it mid-stream.
        const para = 'p'.repeat(400);
        const content = [para, para, para].join('\n\n');
        const r = chunkMarkdown({ content, start: 0, chunkSize: 500 });
        expect(r.nextStartChar).not.toBeNull();
        expect(r.nextStartChar).toBeGreaterThan(0);
        expect(r.nextStartChar).toBeLessThan(content.length);
    });

    it('prefers to break at a paragraph boundary inside the boundary window', () => {
        // chunkSize=500, window=15% → [425, 500). Place `\n\n` at 450 so it lands
        // inside the window; the chunker should snap the cut back to it.
        const a = 'a'.repeat(450);
        const b = 'b'.repeat(400);
        const content = `${a}\n\n${b}`;
        const r = chunkMarkdown({ content, start: 0, chunkSize: 500 });
        expect(r.content.endsWith('\n\n')).toBe(true);
        expect(r.nextStartChar).toBe(r.end);
        expect(content.slice(r.end).startsWith('b')).toBe(true);
    });

    it('falls back to a single newline when no paragraph boundary is in window', () => {
        // 6 lines × 90 chars joined by `\n` → `\n` at 90, 181, 272, 363, 454.
        // chunkSize=500 with window [425, 500) catches the `\n` at 454.
        const line = 'l'.repeat(90);
        const content = Array.from({ length: 6 }, () => line).join('\n');
        const r = chunkMarkdown({ content, start: 0, chunkSize: 500 });
        expect(r.content.endsWith('\n')).toBe(true);
        expect(content.slice(r.end).startsWith('l')).toBe(true);
    });

    it('hard-cuts when no boundary is found within the window', () => {
        const content = 'x'.repeat(5000);
        const r = chunkMarkdown({ content, start: 0, chunkSize: 500 });
        expect(r.end).toBe(500);
        expect(r.content).toHaveLength(500);
        expect(r.nextStartChar).toBe(500);
    });

    it('handles start >= content.length with an empty final chunk', () => {
        const content = 'hello';
        const r = chunkMarkdown({ content, start: 5, chunkSize: 100 });
        expect(r.content).toBe('');
        expect(r.nextStartChar).toBeNull();
    });

    it('resumes from a provided start cursor until the stream terminates', () => {
        const content = `${'a'.repeat(100)}\n\n${'b'.repeat(100)}\n\n${'c'.repeat(100)}`;
        const first = chunkMarkdown({ content, start: 0, chunkSize: 110 });
        expect(first.nextStartChar).not.toBeNull();
        const second = chunkMarkdown({ content, start: first.nextStartChar!, chunkSize: 110 });
        expect(second.start).toBe(first.nextStartChar);
        expect(second.content.length).toBeGreaterThan(0);
        let cursor: number | null = second.nextStartChar;
        let safety = 20;
        while (cursor !== null && safety-- > 0) {
            const step = chunkMarkdown({ content, start: cursor, chunkSize: 110 });
            cursor = step.nextStartChar;
        }
        expect(cursor).toBeNull();
    });

    it('clamps chunk size to the configured minimum', () => {
        const content = 'a'.repeat(2000);
        const r = chunkMarkdown({ content, start: 0, chunkSize: 1 });
        // MIN_CHUNK_SIZE is 100 — requesting 1 should still produce >= 100 chars.
        expect(r.end).toBeGreaterThanOrEqual(100);
    });
});

describe('runExtractFromHtml', () => {
    it('converts HTML to markdown and wraps it in the chunking envelope', () => {
        const html = '<article><h1>Title</h1><p>Hello <strong>world</strong>.</p></article>';
        const r = runExtractFromHtml({
            html,
            url: 'https://example.com/a',
            title: 'Example',
            selector: 'article',
            start: 0,
            chunkSize: 20000,
        });
        expect(r.url).toBe('https://example.com/a');
        expect(r.title).toBe('Example');
        expect(r.selector).toBe('article');
        expect(r.content).toContain('# Title');
        expect(r.content).toContain('**world**');
        expect(r.start).toBe(0);
        expect(r.end).toBe(r.content.length);
        expect(r.total_chars).toBe(r.content.length);
        expect(r.next_start_char).toBeNull();
    });

    it('reports total_chars and chunk_size against the final markdown', () => {
        const body = Array.from({ length: 30 }, (_, i) => `<p>paragraph ${i} ${'x'.repeat(200)}</p>`).join('');
        const r = runExtractFromHtml({
            html: `<main>${body}</main>`,
            url: 'https://example.com/b',
            title: 't',
            selector: 'main',
            start: 0,
            chunkSize: 500,
        });
        expect(r.total_chars).toBeGreaterThan(r.end);
        expect(r.chunk_size).toBe(r.end - r.start);
        expect(r.next_start_char).toBe(r.end);
    });
});

describe('buildExtractHtmlJs', () => {
    it('embeds the selector as a JSON literal', () => {
        const js = buildExtractHtmlJs('main.article');
        expect(js).toContain('"main.article"');
    });

    it('uses null when no selector given', () => {
        const js = buildExtractHtmlJs(null);
        // The expression references `sel` and compares to null.
        expect(js).toContain('const sel = null;');
    });

    it('includes the denoise selector list', () => {
        const js = buildExtractHtmlJs(null);
        expect(js).toContain("'script'");
        expect(js).toContain("'nav'");
        expect(js).toContain("'iframe'");
        expect(js).toContain("'[aria-hidden=\"true\"]'");
    });
});
