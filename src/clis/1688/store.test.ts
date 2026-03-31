import { describe, expect, it } from 'vitest';
import { __test__ } from './store.js';

describe('1688 store normalization', () => {
  it('merges store contact text with seller seed data', () => {
    const result = __test__.normalizeStorePayload({
      resolvedUrl: 'https://yinuoweierfushi.1688.com/?offerId=887904326744',
      explicitMemberId: null,
      storePayload: {
        href: 'https://yinuoweierfushi.1688.com/page/index.html',
        bodyText: `
          青岛沁澜衣品服装有限公司
          联系方式
          地址：山东省青岛市即墨区环秀街道办事处湘江二路97号甲
        `,
        offerLinks: ['https://detail.1688.com/offer/887904326744.html'],
      },
      contactPayload: {
        href: 'https://yinuoweierfushi.1688.com/page/contactinfo.html',
        bodyText: `
          青岛沁澜衣品服装有限公司
          电话：86 0532 86655366
          手机：15963238678
          地址：山东省青岛市即墨区环秀街道办事处湘江二路97号甲
        `,
      },
      seed: {
        bodyText: `
          入驻13年
          主营：大码女装
          店铺回头率
          87%
          延期必赔
          品质保障
        `,
        seller: {
          companyName: '青岛沁澜衣品服装有限公司',
          memberId: 'b2b-1641351767',
          winportUrl: 'https://yinuoweierfushi.1688.com',
        },
        services: [{ serviceName: '延期必赔' }, { serviceName: '品质保障' }],
      },
    });

    expect(result.member_id).toBe('b2b-1641351767');
    expect(result.store_url).toBe('https://yinuoweierfushi.1688.com');
    expect(result.company_url).toBe('https://yinuoweierfushi.1688.com/page/contactinfo.html');
    expect(result.years_on_platform_text).toBe('入驻13年');
    expect(result.location).toBe('山东省青岛市即墨区环秀街道办事处湘江二路97号甲');
    expect(result.return_rate_text).toBe('87%');
    expect(result.top_categories).toEqual(['大码女装']);
    expect(result.service_badges).toEqual(['延期必赔', '品质保障']);
  });

  it('builds contact urls and extracts offer ids', () => {
    expect(__test__.buildContactUrl('https://yinuoweierfushi.1688.com')).toBe(
      'https://yinuoweierfushi.1688.com/page/contactinfo.html',
    );
    expect(__test__.firstOfferId([
      'https://detail.1688.com/offer/887904326744.html',
    ])).toBe('887904326744');
  });
});
