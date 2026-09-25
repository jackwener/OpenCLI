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

    it('retry reloads in place when the soft block rendered at the target URL', async () => {
        // The in-page block variant ("安全限制" at an unchanged URL): a plain
        // goto to the tab's current URL fast-paths in the extension without
        // reloading, so the retry would re-read the same blocked document.
        const page = makePage([
            { securityBlock: true },
            undefined, // location.reload()
            { title: 'recovered', securityBlock: false },
        ]);
        page.getCurrentUrl = vi.fn().mockResolvedValue(url);
        const data = await readXhsDetailPage(page, { url, extractJs, rand: () => 0.5 });
        expect(data).toEqual({ title: 'recovered', securityBlock: false });
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.evaluate.mock.calls[1][0]).toContain('location.reload()');
    });

    it('retry re-navigates when the soft block redirected to the error URL', async () => {
        const page = makePage([{ securityBlock: true }, { title: 'recovered', securityBlock: false }]);
        page.getCurrentUrl = vi.fn().mockResolvedValue(
            'https://www.xiaohongshu.com/website-login/error?error_code=300017',
        );
        const data = await readXhsDetailPage(page, { url, extractJs, rand: () => 0.5 });
        expect(data).toEqual({ title: 'recovered', securityBlock: false });
        expect(page.goto).toHaveBeenCalledTimes(2);
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

describe('xiaohongshu risk-control shared-tab contention', () => {
    // Persistent site sessions share one tab; a concurrent command can
    // navigate it away between our goto and extract, and the extract then
    // reads the WRONG note (observed live: parallel `note` A returned note
    // B's content with a success exit).
    const url = 'https://www.xiaohongshu.com/explore/aaaaaaaaaaaaaaaaaaaaaaaa?xsec_token=tok';
    const extractJs = '(() => ({}))()';
    const rightPage = { title: 'right', securityBlock: false, pageUrl: url };
    const wrongPage = {
        title: 'stolen',
        securityBlock: false,
        pageUrl: 'https://www.xiaohongshu.com/explore/bbbbbbbbbbbbbbbbbbbbbbbb?xsec_token=other',
    };

    it('re-navigates once and returns the payload when the retry lands on the right note', async () => {
        const page = makePage([wrongPage, rightPage]);
        const data = await readXhsDetailPage(page, { url, extractJs, rand: () => 0.5 });
        expect(data).toEqual(rightPage);
        expect(page.goto).toHaveBeenCalledTimes(2);
    });

    it('throws TAB_CONTENTION instead of returning another note silently', async () => {
        const page = makePage([wrongPage, wrongPage, wrongPage]);
        await expect(readXhsDetailPage(page, { url, extractJs, rand: () => 0.5 }))
            .rejects.toMatchObject({ code: 'TAB_CONTENTION' });
        // structural single retry — never a loop
        expect(page.goto).toHaveBeenCalledTimes(2);
    });

    it('honors the never-return-a-block contract when the contention retry lands on a block', async () => {
        const page = makePage([wrongPage, { securityBlock: true }]);
        await expect(readXhsDetailPage(page, { url, extractJs, rand: () => 0.5 }))
            .rejects.toMatchObject({ code: 'SECURITY_BLOCK' });
    });

    it('skips the check when the payload has no extractable note id (login walls, error pages)', async () => {
        const noId = { loginWall: true, securityBlock: false, pageUrl: 'https://www.xiaohongshu.com/login' };
        const page = makePage([noId]);
        const data = await readXhsDetailPage(page, { url, extractJs, rand: () => 0.5 });
        expect(data).toEqual(noId);
        expect(page.goto).toHaveBeenCalledTimes(1);
    });

    it('skips the check for payloads without pageUrl (older extract shapes)', async () => {
        const page = makePage([{ title: 'legacy', securityBlock: false }]);
        const data = await readXhsDetailPage(page, { url, extractJs, rand: () => 0.5 });
        expect(data).toEqual({ title: 'legacy', securityBlock: false });
    });
});
