import { describe, expect, it, vi } from 'vitest';
import { CliError } from '@jackwener/opencli/errors';
import { __test__ } from './risk-control.js';

const { jitterSeconds, isSecurityBlock, readXhsDetailPage } = __test__;

function makePage(evaluateResults) {
    let i = 0;
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockImplementation(() =>
            Promise.resolve(evaluateResults[Math.min(i++, evaluateResults.length - 1)])),
    };
}

describe('xiaohongshu risk-control jitterSeconds', () => {
    it('stays within [min, max] and tracks rand', () => {
        expect(jitterSeconds(2, 5, () => 0)).toBe(2);
        expect(jitterSeconds(2, 5, () => 1)).toBe(5);
        expect(jitterSeconds(2, 5, () => 0.5)).toBe(3.5);
        const v = jitterSeconds(8, 18); // real Math.random
        expect(v).toBeGreaterThanOrEqual(8);
        expect(v).toBeLessThanOrEqual(18);
    });
});

describe('xiaohongshu risk-control isSecurityBlock', () => {
    it('is true only for a plain object flagged securityBlock', () => {
        expect(isSecurityBlock({ securityBlock: true })).toBe(true);
        expect(isSecurityBlock({ securityBlock: false })).toBe(false);
        expect(isSecurityBlock({})).toBe(false);
        expect(isSecurityBlock(null)).toBe(false);
        expect(isSecurityBlock(undefined)).toBe(false);
        expect(isSecurityBlock([{ securityBlock: true }])).toBe(false); // arrays are not payloads
        expect(isSecurityBlock('securityBlock')).toBe(false);
    });
});

describe('xiaohongshu risk-control readXhsDetailPage', () => {
    const url = 'https://www.xiaohongshu.com/search_result/abc?xsec_token=tok';
    const extractJs = '(() => ({}))()';

    it('returns the payload on first read without any cooldown when not blocked', async () => {
        const page = makePage([{ title: 'ok', securityBlock: false }]);
        const data = await readXhsDetailPage(page, { url, extractJs, rand: () => 0.5 });
        expect(data).toEqual({ title: 'ok', securityBlock: false });
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.evaluate).toHaveBeenCalledTimes(1);
        // only the settle wait, no cooldown
        expect(page.wait).toHaveBeenCalledTimes(1);
    });

    it('recovers a transient soft-block with a single cooldown retry', async () => {
        const page = makePage([{ securityBlock: true }, { title: 'recovered', securityBlock: false }]);
        const data = await readXhsDetailPage(page, { url, extractJs, rand: () => 0.5 });
        expect(data).toEqual({ title: 'recovered', securityBlock: false });
        // re-navigated + re-extracted exactly once more
        expect(page.goto).toHaveBeenCalledTimes(2);
        expect(page.evaluate).toHaveBeenCalledTimes(2);
        // a long cooldown wait happened between the two reads: 8 + 0.5*(18-8) = 13
        expect(page.wait).toHaveBeenCalledWith({ time: 13 });
    });

    it('throws SECURITY_BLOCK (with the hint) when still blocked after the one retry — never hammers', async () => {
        const page = makePage([{ securityBlock: true }, { securityBlock: true }, { securityBlock: true }]);
        await expect(readXhsDetailPage(page, {
            url,
            extractJs,
            securityHelp: 'Try again later or from a different session.',
            rand: () => 0.5,
        })).rejects.toMatchObject({
            code: 'SECURITY_BLOCK',
            hint: 'Try again later or from a different session.',
        });
        // exactly one retry — goto/evaluate called twice, not more
        expect(page.goto).toHaveBeenCalledTimes(2);
        expect(page.evaluate).toHaveBeenCalledTimes(2);
    });

    it('fails fast without a retry when retryOnBlock is false', async () => {
        const page = makePage([{ securityBlock: true }, { title: 'never reached', securityBlock: false }]);
        await expect(readXhsDetailPage(page, { url, extractJs, retryOnBlock: false, rand: () => 0.5 }))
            .rejects.toBeInstanceOf(CliError);
        // no cooldown reload — exactly one navigation/extraction
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.evaluate).toHaveBeenCalledTimes(1);
    });

    it('respects custom settle bounds (download uses 1-3s)', async () => {
        const page = makePage([{ media: [], securityBlock: false }]);
        await readXhsDetailPage(page, { url, extractJs, settleMinS: 1, settleMaxS: 3, rand: () => 0 });
        // settle = 1 + 0*(3-1) = 1
        expect(page.wait).toHaveBeenCalledWith({ time: 1 });
    });

    it('passes non-block malformed payloads straight through (caller handles them)', async () => {
        const page = makePage([null]);
        const data = await readXhsDetailPage(page, { url, extractJs, rand: () => 0.5 });
        expect(data).toBeNull();
        expect(page.goto).toHaveBeenCalledTimes(1); // no retry for a non-block result
    });

    it('surfaces SECURITY_BLOCK as a CliError instance', async () => {
        const page = makePage([{ securityBlock: true }, { securityBlock: true }]);
        await expect(readXhsDetailPage(page, { url, extractJs, rand: () => 0.5 }))
            .rejects.toBeInstanceOf(CliError);
    });
});
