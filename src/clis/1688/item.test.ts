import { describe, expect, it } from 'vitest';
import { __test__ } from './item.js';

describe('1688 item normalization', () => {
  it('normalizes public item payload into reportable fields', () => {
    const result = __test__.normalizeItemPayload({
      href: 'https://detail.1688.com/offer/887904326744.html',
      title: '法式春季长袖开衫连衣裙女新款大码女装碎花吊带裙套装142077 - 阿里巴巴',
      bodyText: `
        青岛沁澜衣品服装有限公司
        入驻13年
        主营：大码女装
        店铺回头率
        87%
        山东青岛
        3套起批
        已售1600+套
        支持定制logo
      `,
      offerTitle: '法式春季长袖开衫连衣裙女新款大码女装碎花吊带裙套装142077',
      offerId: 887904326744,
      seller: {
        companyName: '青岛沁澜衣品服装有限公司',
        memberId: 'b2b-1641351767',
        winportUrl: 'https://yinuoweierfushi.1688.com',
      },
      trade: {
        beginAmount: 3,
        priceDisplay: '96.00-98.00',
        unit: '套',
        saleCount: 1655,
        offerIDatacenterSellInfo: {
          面料名称: '莫代尔',
          主面料成分: '莫代尔纤维',
          sellPointModel: '{"ignore":true}',
        },
        offerPriceModel: {
          currentPrices: [
            { beginAmount: 3, price: '98.00' },
            { beginAmount: 50, price: '97.00' },
          ],
        },
      },
      gallery: {
        mainImage: ['https://example.com/1.jpg'],
        offerImgList: ['https://example.com/2.jpg'],
        wlImageInfos: [{ fullPathImageURI: 'https://example.com/3.jpg' }],
      },
      services: [
        { serviceName: '延期必赔', agreeDeliveryHours: 360 },
        { serviceName: '品质保障' },
      ],
    });

    expect(result.offer_id).toBe('887904326744');
    expect(result.member_id).toBe('b2b-1641351767');
    expect(result.shop_id).toBe('yinuoweierfushi');
    expect(result.price_text).toBe('¥96.00-98.00');
    expect(result.moq_text).toBe('3套起批');
    expect(result.origin_place).toBe('山东青岛');
    expect(result.delivery_days_text).toBe('360小时内发货');
    expect(result.private_label_text).toBe('支持定制logo');
    expect(result.visible_attributes).toEqual({
      面料名称: '莫代尔',
      主面料成分: '莫代尔纤维',
    });
  });
});
