import { describe, expect, it } from 'vitest';
import { normalizeWechatUrl } from './download.js';

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
