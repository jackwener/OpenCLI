import { describe, expect, it } from 'vitest';
import { __test__ } from './search.js';

describe('1688 search normalization', () => {
  it('normalizes search candidates into structured result rows', () => {
    const result = __test__.normalizeSearchCandidate({
      item_url: 'https://detail.1688.com/offer/887904326744.html',
      title: '宿舍置物架桌面加高架',
      container_text: '宿舍置物架桌面加高架 ¥56.00 2套起批 山东青岛 已售300+套',
      price_text: '¥ 56 .00',
      sales_text: '300+套',
      moq_text: '2套起批',
      tag_items: ['退货包运费', '回头率52%'],
      hover_items: ['验厂报告'],
      seller_name: '青岛沁澜衣品服装有限公司',
      seller_url: 'https://yinuoweierfushi.1688.com/page/index.html?spm=a123',
    }, 'https://s.1688.com/selloffer/offer_search.htm?charset=utf8&keywords=置物架');

    expect(result.rank).toBe(0);
    expect(result.offer_id).toBe('887904326744');
    expect(result.shop_id).toBe('yinuoweierfushi');
    expect(result.item_url).toBe('https://detail.1688.com/offer/887904326744.html');
    expect(result.seller_url).toBe('https://yinuoweierfushi.1688.com');
    expect(result.price_text).toBe('¥56.00');
    expect(result.price_min).toBe(56);
    expect(result.price_max).toBe(56);
    expect(result.moq_value).toBe(2);
    expect(result.location).toBe('山东青岛');
    expect(result.sales_text).toBe('300+套');
    expect(result.badges).toEqual(expect.arrayContaining(['退货包运费', '验厂报告']));
    expect(result.return_rate_text).toBe('回头率52%');
  });

  it('does not use hover_price_text as MOQ source', () => {
    const result = __test__.normalizeSearchCandidate({
      item_url: 'https://detail.1688.com/offer/887904326744.html',
      title: 'test',
      container_text: 'test ¥56.00',
      price_text: '¥ 56 .00',
      hover_price_text: '¥56.00 3件起批',
      moq_text: null,
    }, 'https://s.1688.com/selloffer/offer_search.htm?charset=utf8&keywords=test');
    // hover_price_text should not be used for MOQ extraction
    expect(result.moq_text).toBeNull();
    expect(result.moq_value).toBeNull();
  });

  it('extracts offer id from mobile detail search links', () => {
    const result = __test__.normalizeSearchCandidate({
      item_url: 'http://detail.m.1688.com/page/index.html?offerId=910933345396&sortType=&pageId=',
      title: '',
      container_text: '桌面书桌办公室工位收纳展示新中式博古架多层茶具厨房摆放置物架 ¥24.3 已售20+件',
      price_text: '¥ 14 .28',
      sales_text: '1500+件',
      moq_text: '≥2个',
      seller_name: '泰商国际贸易（宁阳）有限公司',
      seller_url: 'http://tsgjmy.1688.com/',
    }, 'https://s.1688.com/selloffer/offer_search.htm?charset=utf8&keywords=桌面置物架');

    expect(result.offer_id).toBe('910933345396');
    expect(result.shop_id).toBe('tsgjmy');
    expect(result.item_url).toBe('https://detail.1688.com/offer/910933345396.html');
    expect(result.title).toContain('桌面书桌办公室工位收纳展示');
    expect(result.price_text).toBe('¥14.28');
    expect(result.sales_text).toBe('1500+件');
    expect(result.moq_text).toBe('≥2个');
    expect(result.moq_value).toBe(2);
  });

  it('prefers offer id and falls back to item url for dedupe key', () => {
    expect(__test__.buildDedupeKey({
      offer_id: '123456',
      item_url: 'https://detail.1688.com/offer/123456.html',
    })).toBe('offer:123456');
    expect(__test__.buildDedupeKey({
      offer_id: null,
      item_url: 'https://detail.1688.com/offer/123456.html',
    })).toBe('url:https://detail.1688.com/offer/123456.html');
    expect(__test__.buildDedupeKey({ offer_id: null, item_url: null })).toBeNull();
  });
});
