import { describe, expect, it } from 'vitest';
import { resolveBvid } from './utils.js';
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
