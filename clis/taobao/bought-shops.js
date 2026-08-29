import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError } from '@jackwener/opencli/errors';

export const command = cli({
  site: 'taobao',
  name: 'bought-shops',
  access: 'read',
  description: '获取淘宝购买过的店铺列表 (支持多页翻页拉取、类目筛选、搜索)',
  domain: 'i.taobao.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'query', positional: true, required: false, help: '按店铺名称搜索筛选' },
    { name: 'category', required: false, help: '按店铺行业类目筛选 (如: 数码, 收藏/兴趣, 家居, 男装, 教育培训, DIY)' },
    { name: 'pages', type: 'int', default: 1, help: '翻页抓取的总页数 (默认 1 页, 设为 5 可拉取更多)' },
    { name: 'limit', type: 'int', default: 50, help: '返回的最大店铺数量' },
    { name: 'all', type: 'bool', default: false, help: '是否全量翻页抓取全部购买过的店铺 (最多 25 页)' },
  ],
  columns: [
    'rank',
    'shop',
    'category',
    'is_collected'
  ],
  func: async (page, kwargs) => {
    const maxPages = kwargs.all ? 25 : (kwargs.pages || 1);
    const query = (kwargs.query || '').trim().toLowerCase();
    const catFilter = (kwargs.category || '').trim();
    const limit = kwargs.all ? 1500 : (kwargs.limit || 50);
    
    await page.goto('https://i.taobao.com/my_itaobao/boughtshops');
    await page.wait(4);
    
    const isAuth = await page.evaluate(`
      (() => {
        const text = document.body?.innerText || '';
        return text.includes('购买过的店铺') || text.includes('全部店铺');
      })()
    `);
    
    if (!isAuth) {
      throw new AuthRequiredError('淘宝购买过的店铺需要已登录的浏览器会话');
    }
    
    // If category requested, click that category tab
    if (catFilter) {
      await page.evaluate(`
        ((targetCat) => {
          const tabs = Array.from(document.querySelectorAll('div, span, a')).filter(el => 
            el.innerText && el.innerText.includes(targetCat) && el.children.length <= 2
          );
          if (tabs.length > 0) {
            tabs[tabs.length - 1].click();
          }
        })(${JSON.stringify(catFilter)})
      `);
      await page.wait(3);
    }
    
    const allShops = [];
    
    for (let p = 1; p <= maxPages; p++) {
      const pageShops = await page.evaluate(`
        (() => {
          const text = document.body?.innerText || '';
          const sections = text.split(/(?=\\n[\\u4e00-\\u9fa5a-zA-Z0-9_-]+\\s*\\n\\s*客服\\s*\\n\\s*删除)/).filter(s => s.includes('客服') && s.includes('进入店铺'));
          
          const results = [];
          for (const s of sections) {
            const lines = s.split('\\n').map(l => l.trim()).filter(Boolean);
            const shopName = lines[0];
            if (!shopName || shopName.includes('购买过的店铺') || shopName.length > 40) continue;
            
            const isCollected = s.includes('已收藏');
            results.push({
              shop: shopName,
              is_collected: isCollected ? '已收藏' : '未收藏'
            });
          }
          return results;
        })()
      `);
      
      for (const sh of pageShops) {
        if (!allShops.some(existing => existing.shop === sh.shop)) {
          allShops.push(sh);
        }
      }
      
      if (allShops.length >= limit || p >= maxPages) break;
      
      // Click next page arrow
      const hasNext = await page.evaluate(`
        (() => {
          const arrows = document.querySelectorAll('.pageArrow--QUJ4bp1w');
          const nextArrow = arrows[arrows.length - 1];
          if (nextArrow && !nextArrow.classList.contains('disabled--aSf7sW72')) {
            nextArrow.click();
            return true;
          }
          return false;
        })()
      `);
      
      if (!hasNext) break;
      await page.wait(2.5);
    }
    
    let filtered = allShops;
    if (query) {
      filtered = filtered.filter(s => s.shop.toLowerCase().includes(query));
    }
    
    return filtered.slice(0, limit).map((s, idx) => ({
      rank: idx + 1,
      shop: s.shop,
      category: catFilter || '全部',
      is_collected: s.is_collected
    }));
  }
});
