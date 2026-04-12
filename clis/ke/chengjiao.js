import { cli, Strategy } from '@jackwener/opencli/registry';
import { cityUrl, gotoKe } from './utils.js';

cli({
    site: 'ke',
    name: 'chengjiao',
    description: '贝壳找房成交记录',
    domain: 'ke.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'city', default: 'bj', help: '城市代码，如 bj(北京), sh(上海), gz(广州), sz(深圳), zs(中山)' },
        { name: 'district', help: '区域拼音，如 chaoyang, haidian' },
        { name: 'limit', type: 'int', default: 20, help: '返回数量' },
    ],
    columns: ['title', 'community', 'layout', 'area', 'deal_price', 'unit_price', 'deal_date'],
    func: async (page, kwargs) => {
        const city = kwargs.city || 'bj';
        const limit = Number(kwargs.limit) || 20;
        const base = cityUrl(city);

        let path = '/chengjiao/';
        if (kwargs.district) {
            path = `/chengjiao/${kwargs.district}/`;
        }

        await gotoKe(page, base + path);

        const items = await page.evaluate(`(async () => {
  // chengjiao page uses .listContent li or similar structure
  const selectors = [
    '.listContent li',
    'ul.listContent li',
    '.sellListContent li.clear',
    'li.clear',
  ];
  let cards = [];
  for (const sel of selectors) {
    cards = document.querySelectorAll(sel);
    if (cards.length > 0) break;
  }

  const results = [];
  for (const card of cards) {
    const titleEl = card.querySelector('.title a, a.VIEWDATA');
    if (!titleEl) continue;

    const houseInfoEl = card.querySelector('.houseInfo');
    const communityEl = card.querySelector('.positionInfo a');
    const priceEl = card.querySelector('.totalPrice span');
    const unitPriceEl = card.querySelector('.unitPrice span');
    const dateEl = card.querySelector('.dealDate');
    const dealCycleEl = card.querySelector('.dealCycleTxt span');

    const houseText = (houseInfoEl ? houseInfoEl.textContent : '').replace(/\\s+/g, ' ').trim();
    const houseParts = houseText.split('|').map(s => s.trim());

    const layoutMatch = (houseParts[0] || '').match(/(\\d室\\d厅)/);
    const layout = layoutMatch ? layoutMatch[1] : (houseParts[0] || '');

    results.push({
      title: (titleEl.textContent || '').trim(),
      url: titleEl.href || '',
      community: (communityEl ? communityEl.textContent : '').trim(),
      layout: layout,
      area: (houseParts[1] || '').trim(),
      deal_price: ((priceEl ? priceEl.textContent : '').trim() || '') + '万',
      unit_price: (unitPriceEl ? unitPriceEl.textContent : '').trim(),
      deal_date: (dateEl ? dateEl.textContent : '').replace(/\\s+/g, ' ').trim(),
    });
  }
  return results;
})()`);

        return (items || []).slice(0, limit);
    },
});
