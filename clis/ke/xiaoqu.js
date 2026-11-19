import { cli, Strategy } from '@jackwener/opencli/registry';
import { cityUrl, gotoKe } from './utils.js';
import { buildXiaoquFilterPath } from './xiaoqu-filters.js';

cli({
    site: 'ke',
    name: 'xiaoqu',
    access: 'read',
    description: '贝壳找房小区列表',
    domain: 'ke.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'city', default: 'bj', help: '城市代码，如 bj(北京), sh(上海), gz(广州), sz(深圳), zs(中山), hz(杭州)' },
        { name: 'district', help: '区域拼音，如 chaoyang, haidian, tianhe, xuhui' },
        { name: 'min-price', type: 'int', help: '最低均价（万/㎡）' },
        { name: 'max-price', type: 'int', help: '最高均价（万/㎡）' },
        { name: 'age', choices: ['5', '10', '15', '20', '20+'], help: '楼龄：5/10/15/20 年以内，20+ 为 20 年以上' },
        { name: 'near-subway', type: 'boolean', help: '仅看近地铁小区' },
        { name: 'sort', choices: ['avg-price-asc', 'avg-price-desc'], help: '排序：avg-price-asc|desc(小区均价)；不传为默认排序' },
        { name: 'limit', type: 'int', default: 20, help: '返回数量' },
    ],
    columns: ['name', 'district', 'avg_price', 'year', 'on_sale'],
    func: async (page, kwargs) => {
        const city = kwargs.city || 'bj';
        const limit = Number(kwargs.limit) || 20;
        const base = cityUrl(city);

        let path = '/xiaoqu/';
        if (kwargs.district) {
            path = `/xiaoqu/${kwargs.district}/`;
        }

        const filters = buildXiaoquFilterPath(kwargs);
        await gotoKe(page, base + path + (filters ? filters + '/' : ''));

        const items = await page.evaluate(`(async () => {
  const selectors = [
    '.xiaoquListItem',
    'li.xiaoquListItem',
    '.listContent li',
    'ul.listContent li',
  ];
  let cards = [];
  for (const sel of selectors) {
    cards = document.querySelectorAll(sel);
    if (cards.length > 0) break;
  }

  const results = [];
  for (const card of cards) {
    // Name is in a.img[title] or .title a
    const imgLink = card.querySelector('a.img[title], a[title]');
    const titleLink = card.querySelector('.title a');
    const nameEl = titleLink || imgLink;
    if (!nameEl) continue;

    const name = (titleLink ? titleLink.textContent : imgLink.getAttribute('title')) || '';
    const url = nameEl.href || '';

    const priceEl = card.querySelector('.totalPrice span');
    const districtEl = card.querySelector('.positionInfo a, .district a');
    const infoEl = card.querySelector('.positionInfo, .houseInfo, .xiaoquListItemInfo');
    const saleEl = card.querySelector('.xiaoquListItemSellCount a, .houseInfo a');

    const infoText = infoEl ? infoEl.textContent : '';
    const yearMatch = infoText.match(/(\\d{4})年/);

    const priceText = (priceEl ? priceEl.textContent : '').trim();

    results.push({
      name: name.trim(),
      url: url,
      district: (districtEl ? districtEl.textContent : '').trim(),
      avg_price: priceText ? priceText + '元/平' : '暂无',
      year: yearMatch ? yearMatch[1] : '',
      on_sale: (saleEl ? saleEl.textContent : '').trim(),
    });
  }
  return results;
})()`);

        return (items || []).slice(0, limit);
    },
});
