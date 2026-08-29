import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError } from '@jackwener/opencli/errors';

export const command = cli({
  site: 'taobao',
  name: 'favorites',
  access: 'read',
  description: '查看淘宝宝贝收藏列表 (支持搜索关键词、多轮滚动翻页)',
  domain: 'i.taobao.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'query', positional: true, required: false, help: '搜索或筛选收藏夹商品名称' },
    { name: 'limit', type: 'int', default: 30, help: '返回商品最大条数 (默认 30)' },
    { name: 'all', type: 'bool', default: false, help: '是否全量滚动加载所有收藏夹商品' },
  ],
  columns: [
    'index',
    'title',
    'price',
    'discount',
    'collected_count',
  ],
  func: async (page, kwargs) => {
    const limit = kwargs.all ? 1000 : (kwargs.limit || 30);
    const query = (kwargs.query || '').trim().toLowerCase();
    
    await page.goto('https://i.taobao.com/my_itaobao/itao-tool/collect');
    await page.wait(4);
    
    // Check if auth required
    const isAuth = await page.evaluate(`
      (() => {
        const text = document.body?.innerText || '';
        return text.includes('我的收藏') || text.includes('全部宝贝');
      })()
    `);
    
    if (!isAuth) {
      throw new AuthRequiredError('淘宝收藏夹需要已登录的浏览器会话');
    }
    
    // Auto-scroll loop to load desired quantity
    const scrollTimes = kwargs.all ? 15 : Math.max(1, Math.ceil(limit / 10));
    for (let i = 0; i < scrollTimes; i++) {
      await page.evaluate(`window.scrollTo(0, document.body.scrollHeight)`);
      await page.wait(1.5);
    }
    
    const rawData = await page.evaluate(`
      (() => {
        const text = document.body?.innerText || '';
        const sections = text.split(/(?=进入店铺\\s*\\n\\s*按图找相似)/).filter(s => s.includes('按图找相似'));
        
        const results = [];
        for (const s of sections) {
          const lines = s.split('\\n').map(l => l.trim()).filter(Boolean);
          const similarIdx = lines.findIndex(l => l.includes('按图找相似'));
          if (similarIdx < 0 || !lines[similarIdx + 1]) continue;
          
          const title = lines[similarIdx + 1];
          let collected = '';
          let price = '';
          let discount = '';
          
          for (let i = similarIdx + 2; i < Math.min(similarIdx + 8, lines.length); i++) {
            const l = lines[i];
            if (l.includes('人收藏') || l.includes('收藏')) {
              collected = l;
            } else if (l === '¥' || l === '￥') {
              if (lines[i + 1] && lines[i + 1].match(/^[\\d.]+$/)) {
                price = '¥' + lines[i + 1];
              }
            } else if (l.includes('收藏后降') || l.includes('降价') || l.includes('立减')) {
              discount = l;
            }
          }
          
          results.push({
            title: title.slice(0, 100),
            price: price || '¥0',
            discount: discount || '-',
            collected_count: collected || '-'
          });
        }
        
        return results;
      })()
    `);
    
    let filtered = rawData;
    if (query) {
      filtered = filtered.filter(item => item.title.toLowerCase().includes(query));
    }
    
    const limited = filtered.slice(0, limit);
    return limited.map((item, idx) => ({
      index: idx + 1,
      title: item.title,
      price: item.price,
      discount: item.discount,
      collected_count: item.collected_count,
    }));
  }
});
