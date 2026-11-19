import { cli, Strategy } from '@jackwener/opencli/registry';
import { cityUrl, gotoKe } from './utils.js';
import { buildErshoufangFilterPath } from './filters.js';

cli({
    site: 'ke',
    name: 'ershoufang',
    access: 'read',
    description: '贝壳找房二手房列表',
    domain: 'ke.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'city', default: 'bj', help: '城市代码，如 bj(北京), sh(上海), gz(广州), sz(深圳), zs(中山), hz(杭州)' },
        { name: 'district', help: '区域拼音，如 chaoyang, haidian, tianhe, xihuqu4' },
        { name: 'min-price', type: 'int', help: '最低总价（万元）' },
        { name: 'max-price', type: 'int', help: '最高总价（万元）' },
        { name: 'min-area', type: 'int', help: '最小建筑面积（㎡）' },
        { name: 'max-area', type: 'int', help: '最大建筑面积（㎡）' },
        { name: 'rooms', type: 'int', help: '几居室 (1-5)' },
        { name: 'orientation', choices: ['south-north', 'south', 'east', 'north', 'west'], help: '朝向：south-north(南北)/south(朝南)/east(朝东)/north(朝北)/west(朝西)' },
        { name: 'floor', choices: ['low', 'mid', 'high'], help: '楼层：low(低)/mid(中)/high(高)' },
        { name: 'age', choices: ['5', '10', '15', '20', '20+'], help: '楼龄：5/10/15/20 年以内，20+ 为 20 年以上' },
        { name: 'decoration', choices: ['fine', 'simple', 'rough'], help: '装修：fine(精装)/simple(普通)/rough(毛坯)' },
        { name: 'elevator', choices: ['yes', 'no'], help: '电梯：yes(有)/no(无)' },
        { name: 'features', help: '房源特色，逗号分隔多选：must-see,five-years,two-years,near-subway,vr,new-7d,anytime-view' },
        { name: 'usage', choices: ['residential', 'commercial', 'villa', 'courtyard', 'parking', 'other'], help: '用途：residential(普通住宅)/commercial(商业类)/villa(别墅)/courtyard(四合院)/parking(车位)/other(其他)' },
        { name: 'sort', choices: ['newest', 'total-price-asc', 'total-price-desc', 'unit-price-asc', 'unit-price-desc', 'area-asc', 'area-desc'], help: '排序：newest(最新发布)/total-price-asc|desc(总价)/unit-price-asc|desc(单价)/area-asc|desc(面积)' },
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

        const filters = buildErshoufangFilterPath(kwargs);
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
