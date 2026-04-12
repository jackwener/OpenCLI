import { cli, Strategy } from '@jackwener/opencli/registry';
import { cityUrl, gotoKe } from './utils.js';

cli({
    site: 'ke',
    name: 'ershoufang',
    description: '贝壳找房二手房列表',
    domain: 'ke.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'city', default: 'bj', help: '城市代码，如 bj(北京), sh(上海), gz(广州), sz(深圳), zs(中山)' },
        { name: 'district', help: '区域拼音，如 chaoyang, haidian, tianhe' },
        { name: 'min-price', type: 'int', help: '最低总价（万元）' },
        { name: 'max-price', type: 'int', help: '最高总价（万元）' },
        { name: 'rooms', type: 'int', help: '几居室 (1-5)' },
        { name: 'limit', type: 'int', default: 20, help: '返回数量' },
    ],
    columns: ['title', 'community', 'layout', 'area', 'direction', 'total_price', 'unit_price', 'url'],
    func: async (page, kwargs) => {
        const city = kwargs.city || 'bj';
        const limit = Number(kwargs.limit) || 20;
        const base = cityUrl(city);

        let path = '/ershoufang/';
        if (kwargs.district) {
            path = `/ershoufang/${kwargs.district}/`;
        }

        const priceParts = [];
        if (kwargs['min-price'] || kwargs['max-price']) {
            const min = kwargs['min-price'] || '';
            const max = kwargs['max-price'] || '';
            priceParts.push(`p${min}t${max}`);
        }

        const roomParts = [];
        if (kwargs.rooms) {
            roomParts.push(`l${kwargs.rooms}`);
        }

        const filters = [...priceParts, ...roomParts].join('');
        const url = base + path + (filters ? filters + '/' : '');

        await gotoKe(page, url);

        const items = await page.evaluate(`(async () => {
  const cards = document.querySelectorAll('.sellListContent li.clear');
  const results = [];
  for (const card of cards) {
    const titleEl = card.querySelector('.title a');
    const communityEl = card.querySelector('.positionInfo a');
    const houseInfoEl = card.querySelector('.houseInfo');
    const priceEl = card.querySelector('.totalPrice span');
    const unitPriceEl = card.querySelector('.unitPrice span');

    if (!titleEl) continue;

    // houseInfo text varies:
    //   "中楼层 (共24层) 4室2厅 | 133.99平米 | 东南"
    //   "高楼层 (共32层) | 2022年 | 4室2厅 | 110平米"
    const houseText = (houseInfoEl ? houseInfoEl.textContent : '').replace(/\\s+/g, ' ').trim();
    const houseParts = houseText.split('|').map(s => s.trim());

    // Extract structured fields from all parts
    let layout = '', area = '', direction = '', floor = '';
    for (const part of houseParts) {
      if (/\\d室\\d厅/.test(part)) {
        layout = part.match(/(\\d室\\d厅)/)[1];
      } else if (/平米|㎡/.test(part)) {
        area = part;
      } else if (/^[东南西北]+$/.test(part.replace(/\\s/g, ''))) {
        direction = part;
      } else if (/楼层/.test(part)) {
        floor = part;
      }
    }
    // layout might be embedded in the floor part: "中楼层 (共24层) 4室2厅"
    if (!layout) {
      const m = houseText.match(/(\\d室\\d厅)/);
      if (m) layout = m[1];
    }

    results.push({
      title: (titleEl.textContent || '').trim(),
      url: titleEl.href || '',
      community: (communityEl ? communityEl.textContent : '').trim(),
      layout: layout,
      area: area,
      direction: direction,
      total_price: ((priceEl ? priceEl.textContent : '').trim() || '') + '万',
      unit_price: (unitPriceEl ? unitPriceEl.textContent : '').trim(),
    });
  }
  return results;
})()`);

        return (items || []).slice(0, limit);
    },
});
