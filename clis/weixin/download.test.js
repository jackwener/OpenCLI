import { describe, expect, it, vi } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import { awaitWechatArticle, normalizeWechatUrl } from './download.js';

describe('normalizeWechatUrl', () => {
    const canonical = 'https://mp.weixin.qq.com/s/oBz-oik0i9YM2Uia_aadjw';

    it('returns the input unchanged when already canonical', () => {
        expect(normalizeWechatUrl(canonical)).toBe(canonical);
    });

    it('returns empty string for empty / nullish input', () => {
        expect(normalizeWechatUrl('')).toBe('');
        expect(normalizeWechatUrl(null)).toBe('');
        expect(normalizeWechatUrl(undefined)).toBe('');
    });

    it('strips ASCII straight double quotes', () => {
        expect(normalizeWechatUrl(`"${canonical}"`)).toBe(canonical);
    });

    it('strips ASCII straight single quotes', () => {
        expect(normalizeWechatUrl(`'${canonical}'`)).toBe(canonical);
    });

    it('strips CJK curly double quotes (U+201C / U+201D)', () => {
        // Wrap the URL in left/right curly double quotes — common when
        // copy-pasting from WeChat / macOS smart-quote substitution.
        expect(normalizeWechatUrl(`“${canonical}”`)).toBe(canonical);
    });

    it('strips CJK curly single quotes (U+2018 / U+2019)', () => {
        expect(normalizeWechatUrl(`‘${canonical}’`)).toBe(canonical);
    });

    it('strips CJK corner brackets 「 」 (U+300C / U+300D)', () => {
        expect(normalizeWechatUrl(`「${canonical}」`)).toBe(canonical);
    });

    it('strips CJK white corner brackets 『 』 (U+300E / U+300F)', () => {
        expect(normalizeWechatUrl(`『${canonical}』`)).toBe(canonical);
    });

    it('strips German-style double quotes „ ‟ (U+201E / U+201F)', () => {
        expect(normalizeWechatUrl(`„${canonical}‟`)).toBe(canonical);
    });

    it('strips single guillemets ‹ › (U+2039 / U+203A)', () => {
        expect(normalizeWechatUrl(`‹${canonical}›`)).toBe(canonical);
    });

    it('strips double guillemets « » (U+00AB / U+00BB)', () => {
        expect(normalizeWechatUrl(`«${canonical}»`)).toBe(canonical);
    });

    it('strips wrapping angle brackets < >', () => {
        expect(normalizeWechatUrl(`<${canonical}>`)).toBe(canonical);
    });

    it('handles whitespace around the wrapping quotes', () => {
        expect(normalizeWechatUrl(`   “${canonical}”   `)).toBe(canonical);
    });

    it('strips one-sided trailing smart quotes from pasted URL text', () => {
        expect(normalizeWechatUrl(`${canonical}”`)).toBe(canonical);
        expect(normalizeWechatUrl(`${canonical}」`)).toBe(canonical);
        expect(normalizeWechatUrl(`${canonical}>`)).toBe(canonical);
    });

    it('strips one-sided leading smart quotes from pasted URL text', () => {
        expect(normalizeWechatUrl(`“${canonical}`)).toBe(canonical);
        expect(normalizeWechatUrl(`「${canonical}`)).toBe(canonical);
        expect(normalizeWechatUrl(`<${canonical}`)).toBe(canonical);
    });

    it('strips asymmetric boundary quote punctuation without touching the URL body', () => {
        expect(normalizeWechatUrl(`“${canonical}"`)).toBe(canonical);
    });

    it('does not strip encoded quote-like characters inside the URL', () => {
        const withEncodedQuote = 'https://mp.weixin.qq.com/s/oBz-oik0i9YM2Uia_aadjw?note=%E2%80%9D#frag';
        expect(normalizeWechatUrl(withEncodedQuote)).toBe(withEncodedQuote);
    });

    it('removes backslash escapes inserted by some shells', () => {
        const escaped = 'https\\://mp.weixin.qq.com/s/oBz-oik0i9YM2Uia_aadjw';
        expect(normalizeWechatUrl(escaped)).toBe(canonical);
    });

    it('decodes &amp; HTML entity', () => {
        const html = 'https://mp.weixin.qq.com/s?foo=1&amp;bar=2';
        expect(normalizeWechatUrl(html)).toBe('https://mp.weixin.qq.com/s?foo=1&bar=2');
    });

    it('handles bare mp.weixin.qq.com hostname (no protocol)', () => {
        expect(normalizeWechatUrl('mp.weixin.qq.com/s/oBz-oik0i9YM2Uia_aadjw')).toBe(canonical);
    });

    it('handles //mp.weixin.qq.com/... protocol-relative URL', () => {
        expect(normalizeWechatUrl('//mp.weixin.qq.com/s/oBz-oik0i9YM2Uia_aadjw')).toBe(canonical);
    });

    it('forces https:// for mp.weixin.qq.com http:// links', () => {
        const http = 'http://mp.weixin.qq.com/s/oBz-oik0i9YM2Uia_aadjw';
        expect(normalizeWechatUrl(http)).toBe(canonical);
    });
});

const VERIFICATION_PAYLOAD = { title: '', errorHint: 'environment verification required', contentHtml: '' };
const ARTICLE_PAYLOAD = { title: 'Article', errorHint: '', contentHtml: '<p>body</p>' };

describe('awaitWechatArticle', () => {
    it('returns immediately when the article is readable', async () => {
        const extract = vi.fn().mockResolvedValue(ARTICLE_PAYLOAD);
        const wait = vi.fn().mockResolvedValue(undefined);
        const data = await awaitWechatArticle(extract, wait, { timeoutMs: 15000, pollIntervalS: 1 });
        expect(data).toBe(ARTICLE_PAYLOAD);
        expect(extract).toHaveBeenCalledTimes(1);
        expect(wait).not.toHaveBeenCalled();
    });

    it('polls through a captcha that auto-resolves (#2045)', async () => {
        const extract = vi.fn()
            .mockResolvedValueOnce(VERIFICATION_PAYLOAD)
            .mockResolvedValueOnce(VERIFICATION_PAYLOAD)
            .mockResolvedValueOnce(ARTICLE_PAYLOAD);
        const wait = vi.fn().mockResolvedValue(undefined);
        const data = await awaitWechatArticle(extract, wait, { timeoutMs: 15000, pollIntervalS: 1 });
        expect(data).toBe(ARTICLE_PAYLOAD);
        expect(extract).toHaveBeenCalledTimes(3);
        expect(wait).toHaveBeenCalledTimes(2);
        expect(wait).toHaveBeenCalledWith(1);
    });

    it('returns the verification payload when the budget is exhausted', async () => {
        const extract = vi.fn().mockResolvedValue(VERIFICATION_PAYLOAD);
        const wait = vi.fn().mockResolvedValue(undefined);
        const data = await awaitWechatArticle(extract, wait, { timeoutMs: 0 });
        expect(data).toBe(VERIFICATION_PAYLOAD);
        expect(extract).toHaveBeenCalledTimes(1);
        expect(wait).not.toHaveBeenCalled();
    });

    it('waits through the empty render between verification and article', async () => {
        const extract = vi.fn()
            .mockResolvedValueOnce(VERIFICATION_PAYLOAD)
            .mockResolvedValueOnce({ title: '', errorHint: '', contentHtml: '' })
            .mockResolvedValueOnce(ARTICLE_PAYLOAD);
        const wait = vi.fn().mockResolvedValue(undefined);
        expect(await awaitWechatArticle(extract, wait)).toBe(ARTICLE_PAYLOAD);
        expect(wait).toHaveBeenCalledTimes(2);
    });

    it('bounds the last wait and reports unresolved empty renders as verification timeout', async () => {
        vi.useFakeTimers();
        try {
            const extract = vi.fn().mockResolvedValueOnce(VERIFICATION_PAYLOAD)
                .mockResolvedValue({ title: '', errorHint: '', contentHtml: '' });
            const wait = vi.fn(async seconds => { vi.advanceTimersByTime(seconds * 1000); });
            expect(await awaitWechatArticle(extract, wait, { timeoutMs: 500 })).toBe(VERIFICATION_PAYLOAD);
            expect(wait).toHaveBeenCalledExactlyOnceWith(0.5);
        } finally {
            vi.useRealTimers();
        }
    });

    it('stops on a terminal access error after verification', async () => {
        const terminal = { errorHint: 'article deleted', contentHtml: '' };
        const extract = vi.fn().mockResolvedValueOnce(VERIFICATION_PAYLOAD).mockResolvedValue(terminal);
        expect(await awaitWechatArticle(extract, vi.fn())).toBe(terminal);
        expect(extract).toHaveBeenCalledTimes(2);
    });

    it('honours the custom poll interval', async () => {
        const extract = vi.fn()
            .mockResolvedValueOnce(VERIFICATION_PAYLOAD)
            .mockResolvedValueOnce(ARTICLE_PAYLOAD);
        const wait = vi.fn().mockResolvedValue(undefined);
        await awaitWechatArticle(extract, wait, { timeoutMs: 15000, pollIntervalS: 2 });
        expect(wait).toHaveBeenCalledWith(2);
    });
});

function createWeixinPage(payload) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(payload),
    };
}

describe('weixin download command (#2045)', () => {
    const canonical = 'https://mp.weixin.qq.com/s/oBz-oik0i9YM2Uia_aadjw';
    const baseArgs = { url: canonical, output: '/tmp/opencli-weixin-test', 'download-images': false };

    it('reports the gate only after the verification budget is spent', async () => {
        const page = createWeixinPage(VERIFICATION_PAYLOAD);
        const rows = await getRegistry().get('weixin/download').func(page, { ...baseArgs, 'verification-timeout': 0 });
        expect(rows[0].status).toContain('did not clear within 0s');
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.evaluate).toHaveBeenCalledTimes(1);
    });

    it('rejects an out-of-range --verification-timeout before navigating', async () => {
        const page = createWeixinPage(ARTICLE_PAYLOAD);
        await expect(getRegistry().get('weixin/download').func(page, { ...baseArgs, 'verification-timeout': 121 }))
            .rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });
});
