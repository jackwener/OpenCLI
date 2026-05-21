import { describe, expect, it, vi } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import { __test__ } from './add-source.js';

const {
    parseSourceUrl,
    parseSourceText,
    parseSourceTitle,
    buildAddSourceFromUrlArgs,
    buildAddSourceFromTextArgs,
    parseAddSourceResult,
} = __test__;

describe('notebooklm add-source', () => {
    it('parseSourceUrl accepts http and https URLs', () => {
        expect(parseSourceUrl('https://en.wikipedia.org/wiki/Reti_Opening'))
            .toBe('https://en.wikipedia.org/wiki/Reti_Opening');
        expect(parseSourceUrl('  http://example.com/page  ')).toBe('http://example.com/page');
    });

    it('parseSourceUrl returns empty string for unset, rejects bad schemes', () => {
        expect(parseSourceUrl('')).toBe('');
        expect(parseSourceUrl(undefined)).toBe('');
        expect(parseSourceUrl('   ')).toBe('');
        expect(() => parseSourceUrl('ftp://example.com')).toThrow(ArgumentError);
        expect(() => parseSourceUrl('javascript:alert(1)')).toThrow(ArgumentError);
        expect(() => parseSourceUrl('https://')).toThrow(ArgumentError);
    });

    it('parseSourceText returns the content for non-empty, null for unset', () => {
        expect(parseSourceText('hello body')).toBe('hello body');
        expect(parseSourceText(undefined)).toBeNull();
        expect(parseSourceText(null)).toBeNull();
    });

    it('parseSourceText rejects whitespace-only and oversized content', () => {
        expect(() => parseSourceText('   ')).toThrow(ArgumentError);
        expect(() => parseSourceText('x'.repeat(10 * 1024 * 1024 + 1))).toThrow(ArgumentError);
    });

    it('parseSourceTitle trims and falls back to the default label', () => {
        expect(parseSourceTitle('Custom title', 'Text Source')).toBe('Custom title');
        expect(parseSourceTitle('   ', 'Text Source')).toBe('Text Source');
        expect(parseSourceTitle(undefined, 'Text Source')).toBe('Text Source');
    });

    it('buildAddSourceFromUrlArgs wraps the url in the expected nested shape', () => {
        const args = buildAddSourceFromUrlArgs('nb-123', 'https://example.com/a');
        expect(args).toEqual([[[null, null, ['https://example.com/a']]], 'nb-123']);
    });

    it('buildAddSourceFromTextArgs uses the text inner tuple with source-type 2', () => {
        const args = buildAddSourceFromTextArgs('nb-123', 'My Title', 'paragraph one');
        expect(args).toEqual([[[null, ['My Title', 'paragraph one'], null, 2]], 'nb-123']);
    });

    it('parseAddSourceResult finds the source-id UUID anywhere in the wrapped result', () => {
        const id = 'af732fa4-01c2-4de4-9d0a-933f2c29ee1e';
        expect(parseAddSourceResult([[[ [id] ]]])).toBe(id);
        expect(parseAddSourceResult([ 'project', null, [[id, 'title']] ])).toBe(id);
        expect(parseAddSourceResult({ project: { sources: [{ sourceId: { sourceId: id } }] } })).toBe(id);
    });

    it('parseAddSourceResult returns the first UUID when several appear', () => {
        const a = '11111111-1111-4111-8111-111111111111';
        const b = '22222222-2222-4222-8222-222222222222';
        expect(parseAddSourceResult([[[ [a], [b] ]]])).toBe(a);
    });

    it('parseAddSourceResult skips known input ids before selecting the new source id', () => {
        const notebookId = '17e2b882-6a01-4c6c-9262-0738dfa2abee';
        const sourceId = 'af732fa4-01c2-4de4-9d0a-933f2c29ee1e';
        expect(parseAddSourceResult([notebookId, [[sourceId, 'title']]], [notebookId])).toBe(sourceId);
    });

    it('parseAddSourceResult ignores non-UUID strings', () => {
        expect(parseAddSourceResult([ 'project-id', 'not-a-uuid', 'still-not' ])).toBe('');
    });

    it('parseAddSourceResult returns empty string for unparseable shapes', () => {
        expect(parseAddSourceResult(null)).toBe('');
        expect(parseAddSourceResult({})).toBe('');
        expect(parseAddSourceResult([])).toBe('');
        expect(parseAddSourceResult([[]])).toBe('');
    });

    it('refuses to add a remote source without --execute', async () => {
        const command = getRegistry().get('notebooklm/add-source');
        const page = { goto: vi.fn() };
        await expect(command.func(page, {
            notebook: '17e2b882-6a01-4c6c-9262-0738dfa2abee',
            content: 'source body',
        })).rejects.toThrow(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });
});
