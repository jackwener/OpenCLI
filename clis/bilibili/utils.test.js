import { describe, expect, it } from 'vitest';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { resolveBvid, resolveUid } from './utils.js';
describe('resolveBvid', () => {
    it('passes through a valid BV ID', async () => {
        expect(await resolveBvid('BV1MV9NBtENN')).toBe('BV1MV9NBtENN');
    });
    it('passes through BV ID with surrounding whitespace', async () => {
        expect(await resolveBvid('  BV1MV9NBtENN  ')).toBe('BV1MV9NBtENN');
    });
    it('handles non-string input via String() coercion', async () => {
        expect(await resolveBvid('BV123abc')).toBe('BV123abc');
    });
    it('extracts BV IDs from bilibili video URLs', async () => {
        expect(await resolveBvid('https://www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=333.1007')).toBe('BV1xx411c7mD');
        expect(await resolveBvid('https://m.bilibili.com/video/BV1Je9EBnEha')).toBe('BV1Je9EBnEha');
    });
    it('rejects invalid input that cannot be resolved', async () => {
        // A random string that b23.tv won't resolve — should timeout or fail
        await expect(resolveBvid('not-a-valid-code-99999')).rejects.toThrow();
    });
});

describe('resolveUid', () => {
    function pageWithUserSearchResult(result) {
        return {
            evaluate: async (script) => {
                if (String(script).includes('/x/web-interface/nav')) {
                    return {
                        data: {
                            wbi_img: {
                                img_url: 'https://i0.hdslb.com/bfs/wbi/abcdefghijklmnopqrstuvwxyz123456.png',
                                sub_url: 'https://i0.hdslb.com/bfs/wbi/ABCDEFGHIJKLMNOPQRSTUVWXYZ123456.png',
                            },
                        },
                    };
                }
                return result;
            },
        };
    }

    it('returns numeric uid input without searching', async () => {
        expect(await resolveUid({}, '12345')).toBe('12345');
    });

    it('fails closed when user search payload lacks result', async () => {
        await expect(resolveUid(pageWithUserSearchResult({ code: 0, data: {} }), 'missing'))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('fails closed when user search result row lacks mid', async () => {
        await expect(resolveUid(pageWithUserSearchResult({ code: 0, data: { result: [{}] } }), 'missing-mid'))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('keeps explicit no-user result as EmptyResultError', async () => {
        await expect(resolveUid(pageWithUserSearchResult({ code: 0, data: { result: [] } }), 'nobody'))
            .rejects.toBeInstanceOf(EmptyResultError);
    });
});
