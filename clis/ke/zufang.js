import { cli, Strategy } from '@jackwener/opencli/registry';
import { gotoKe } from './utils.js';

cli({
    site: 'ke',
    name: 'zufang',
    description: '贝壳找房租房列表',
    domain: 'ke.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'city', default: 'bj', help: '城市代码，如 bj(北京), sh(上海), gz(广州), sz(深圳), zs(中山)' },
        { name: 'district', help: '区域拼音，如 chaoyang, haidian' },
        { name: 'min-price', type: 'int', help: '最低月租（元）' },
        { name: 'max-price', type: 'int', help: '最高月租（元）' },
        { name: 'limit', type: 'int', default: 20, help: '返回数量' },
    ],
    columns: ['title', 'community', 'area', 'layout', 'price', 'url'],
    func: async (page, kwargs) => {
        const city = kwargs.city || 'bj';
        const limit = Number(kwargs.limit) || 20;

        let path = '/zufang/';
        if (kwargs.district) {
            path = `/zufang/${kwargs.district}/`;
        }

        const priceParts = [];
        if (kwargs['min-price'] || kwargs['max-price']) {
            const min = kwargs['min-price'] || '';
            const max = kwargs['max-price'] || '';
            priceParts.push(`rp${min}t${max}`);
        }
        const filters = priceParts.join('');

        const baseUrl = `https://${city}.zu.ke.com`;
        const url = baseUrl + path + (filters ? filters + '/' : '');

        await gotoKe(page, url);

        const items = await page.evaluate(`(async () => {
  const allLinks = document.querySelectorAll('a.twoline');
  const results = [];
  for (const titleEl of allLinks) {
    let card = titleEl.closest('div');
    if (!card) continue;
    while (card && card.parentElement && !card.parentElement.classList.contains('content__list')) {
      card = card.parentElement;
    }
    if (!card) continue;

    const title = (titleEl.textContent || '').replace(/\\s+/g, ' ').trim();
    const href = titleEl.getAttribute('href') || '';
    const fullUrl = href.startsWith('http') ? href : '${baseUrl}' + href;

    const allPs = card.querySelectorAll('p');
    let community = '', area = '', layout = '';
    for (const p of allPs) {
      if ((p.className || '').indexOf('des') === -1) continue;
      const links = p.querySelectorAll('a[title]');
      if (links.length > 0) {
        community = (links[links.length - 1].getAttribute('title') || '').trim();
      }
      const parts = p.textContent.replace(/\\s+/g, ' ').trim().split('/');
      for (const part of parts) {
        const t = part.trim();
        if (/\\u33A1|\\u5E73\\u7C73/.test(t)) area = t;
        else if (/\\u5BA4.*\\u5385/.test(t)) layout = t;
      }
      break;
    }

    const emEls = card.querySelectorAll('em');
    let priceText = '';
    for (const em of emEls) {
      const t = em.textContent.trim();
      if (/^\\d+$/.test(t)) { priceText = t; break; }
    }

    results.push({
      title,
      url: fullUrl,
      community,
      area,
      layout,
      price: priceText ? priceText + '\\u5143/\\u6708' : '',
    });
  }
  return results;
})()`);

        return (items || []).slice(0, limit);
    },
});
