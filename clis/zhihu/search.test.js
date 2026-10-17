import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './search.js';

const {
    normalizeSearchUrl,
    requireSearchPayload,
    normalizeResultItem,
} = await import('./search.js').then((m) => m.__test__);

describe('zhihu search', () => {
    it('unwraps Browser Bridge envelopes and fails typed on malformed payloads', () => {
        const payload = { data: [], paging: { is_end: true } };
        expect(requireSearchPayload({ session: {}, data: payload }, 'https://www.zhihu.com/api/v4/search_v3')).toBe(payload);
        expect(() => requireSearchPayload(null, 'url')).toThrow(CommandExecutionError);
        expect(() => requireSearchPayload({ data: null, paging: { is_end: true } }, 'url')).toThrow(CommandExecutionError);
        expect(() => requireSearchPayload({ data: [], paging: null }, 'url')).toThrow(CommandExecutionError);
        expect(() => requireSearchPayload({ __fetchError: 'network down' }, 'url')).toThrow(CommandExecutionError);
    });

    it('fails typed on malformed supported result rows instead of emitting blank identity rows', () => {
        expect(() => normalizeResultItem({ type: 'search_result', object: { type: 'answer', id: 'a1', question: { name: 'missing question id' } } }))
            .toThrow(CommandExecutionError);
        expect(() => normalizeResultItem({ type: 'search_result', object: { type: 'article', id: 'p1' } }))
            .toThrow(CommandExecutionError);
        expect(normalizeResultItem({ type: 'hot_timing', object: { type: 'article', id: 'p1' } })).toBe(null);
    });

    it('rejects malformed pagination next URLs and reports valid empty result separately', async () => {
        expect(normalizeSearchUrl('https://api.zhihu.com/search_v3?offset=20&q=codex'))
            .toBe('https://www.zhihu.com/api/v4/search_v3?offset=20&q=codex');
        expect(normalizeSearchUrl('https://evil.example/search_v3?offset=20')).toBe('');

        const cmd = getRegistry().get('zhihu/search');
        const malformedNextPage = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({
                data: [],
                paging: { is_end: false, next: 'https://evil.example/search_v3?offset=20' },
            }),
        };
        await expect(cmd.func(malformedNextPage, { query: 'codex', limit: 3 }))
            .rejects.toBeInstanceOf(CommandExecutionError);

        const emptyPage = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({ data: [], paging: { is_end: true } }),
        };
        await expect(cmd.func(emptyPage, { query: 'codex', limit: 3 }))
            .rejects.toBeInstanceOf(EmptyResultError);
    });
});
