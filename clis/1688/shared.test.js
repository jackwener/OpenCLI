import { describe, expect, it } from 'vitest';
import { __test__ } from './shared.js';
describe('1688 shared helpers', () => {
    it('builds encoded search URLs and validates limit', () => {
        expect(__test__.buildSearchUrl('置物架')).toBe('https://s.1688.com/selloffer/offer_search.htm?charset=utf8&keywords=%E7%BD%AE%E7%89%A9%E6%9E%B6');
        expect(() => __test__.buildSearchUrl('   ')).toThrowError(/cannot be empty/i);
        expect(__test__.parseSearchLimit(3)).toBe(3);
        expect(__test__.parseSearchLimit('1000')).toBe(__test__.SEARCH_LIMIT_MAX);
        expect(() => __test__.parseSearchLimit('0')).toThrowError(/positive integer/i);
    });
    it('extracts IDs and canonicalizes urls', () => {
        expect(__test__.extractOfferId('887904326744')).toBe('887904326744');
        expect(__test__.extractOfferId('https://detail.1688.com/offer/887904326744.html')).toBe('887904326744');
        expect(__test__.extractMemberId('https://winport.m.1688.com/page/index.html?memberId=b2b-1641351767')).toBe('b2b-1641351767');
        expect(__test__.extractMemberId('b2b-22154705262941f196')).toBe('b2b-22154705262941f196');
        expect(__test__.resolveStoreUrl('b2b-22154705262941f196')).toBe('https://winport.m.1688.com/page/index.html?memberId=b2b-22154705262941f196');
        expect(__test__.canonicalizeStoreUrl('https://yinuoweierfushi.1688.com/page/index.html?spm=foo')).toBe('https://yinuoweierfushi.1688.com');
        expect(__test__.canonicalizeItemUrl('http://detail.m.1688.com/page/index.html?offerId=910933345396&spm=x')).toBe('https://detail.1688.com/offer/910933345396.html');
        expect(__test__.canonicalizeSellerUrl('https://yinuoweierfushi.1688.com/page/contactinfo.html?tracelog=1')).toBe('https://yinuoweierfushi.1688.com');
        expect(__test__.extractShopId('https://yinuoweierfushi.1688.com/page/index.html')).toBe('yinuoweierfushi');
    });
    it('parses price ranges and moq text', () => {
        expect(__test__.parsePriceText('¥96.00-98.00')).toEqual({
            price_text: '¥96.00-98.00',
            price_min: 96,
            price_max: 98,
            currency: 'CNY',
        });
        expect(__test__.parsePriceText('¥ 14 .28')).toEqual({
            price_text: '¥14.28',
            price_min: 14.28,
            price_max: 14.28,
            currency: 'CNY',
        });
        expect(__test__.parseMoqText('3套起批')).toEqual({
            moq_text: '3套起批',
            moq_value: 3,
        });
        expect(__test__.parseMoqText('2~999个')).toEqual({
            moq_text: '2~999个',
            moq_value: 2,
        });
    });
    it('detects captcha and login states', () => {
        expect(__test__.extractLocation('山东青岛 送至 江苏苏州')).toBe('山东青岛');
        expect(__test__.isCaptchaState({
            href: 'https://s.1688.com/_____tmd_____/punish',
            title: '验证码拦截',
            body_text: '请拖动下方滑块完成验证',
        })).toBe(true);
        expect(__test__.isLoginState({
            href: 'https://login.taobao.com/member/login.jhtml',
            title: '账号登录',
            body_text: '请登录后继续',
        })).toBe(true);
    });
});
