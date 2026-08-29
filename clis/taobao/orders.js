import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError } from '@jackwener/opencli/errors';

export const command = cli({
  site: 'taobao',
  name: 'orders',
  access: 'read',
  description: '获取淘宝已买到的宝贝 / 历史订单列表 (支持跨页翻页拉取、关键词搜索、状态过滤)',
  domain: 'buyertrade.taobao.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'query', positional: true, required: false, help: '按商品名称、店铺名或订单号搜索筛选' },
    { name: 'pages', type: 'int', default: 1, help: '翻页抓取的总页数 (默认 1 页 = 30条, 设为 5 可拉取 150条)' },
    { name: 'limit', type: 'int', default: 50, help: '返回的最大订单数量' },
    { name: 'all', type: 'bool', default: false, help: '是否全量翻页拉取全部历史订单 (最多翻 50 页)' },
    { name: 'status', required: false, help: '按订单状态筛选 (如: 交易成功, 待发货, 待收货, 待付款)' },
  ],
  columns: [
    'order_date',
    'shop',
    'status',
    'title',
    'spec',
    'total_paid',
    'order_id'
  ],
  func: async (page, kwargs) => {
    const maxPages = kwargs.all ? 50 : (kwargs.pages || 1);
    const query = (kwargs.query || '').trim().toLowerCase();
    const statusFilter = (kwargs.status || '').trim();
    const limit = kwargs.all ? 2000 : (kwargs.limit || 50);
    
    await page.goto('https://buyertrade.taobao.com/trade/itemlist/list_bought_items.htm');
    await page.wait(4);
    
    const isAuth = await page.evaluate(`
      (() => {
        const text = document.body?.innerText || '';
        return text.includes('已买到的宝贝') || text.includes('所有订单');
      })()
    `);
    
    if (!isAuth) {
      throw new AuthRequiredError('淘宝已买到的宝贝需要已登录的浏览器会话');
    }
    
    const allOrders = [];
    
    for (let p = 1; p <= maxPages; p++) {
      const pageOrders = await page.evaluate(`
        (() => {
          const text = document.body?.innerText || '';
          const parts = text.split(/(?=\\d{4}-\\d{2}-\\d{2}\\s*\\n\\s*订单号:)/);
          
          const parsedOrders = [];
          for (const p of parts) {
            const lines = p.split('\\n').map(s => s.trim()).filter(Boolean);
            const orderMatch = p.match(/订单号:\\s*(\\d+)/);
            const dateMatch = p.match(/(\\d{4}-\\d{2}-\\d{2})/);
            if (!orderMatch) continue;
            
            const orderId = orderMatch[1];
            const orderDate = dateMatch ? dateMatch[1] : '';
            
            let shopName = '';
            let status = '交易成功';
            let title = '';
            let spec = '';
            let price = '';
            let total = '';
            
            const orderIdx = lines.findIndex(l => l.includes('订单号:'));
            if (orderIdx >= 0 && lines[orderIdx + 1]) {
              shopName = lines[orderIdx + 1];
            }
            
            if (p.includes('交易成功')) status = '交易成功';
            else if (p.includes('待付款')) status = '待付款';
            else if (p.includes('待发货')) status = '待发货';
            else if (p.includes('待收货')) status = '待收货';
            else if (p.includes('交易关闭')) status = '交易关闭';
            
            const totalMatch = p.match(/实付款\\s*[¥￥]\\s*([\\d.]+)/);
            if (totalMatch) total = '￥' + totalMatch[1];
            
            const statusIdx = lines.findIndex(l => l.includes('交易成功') || l.includes('交易关闭') || l.includes('待发货') || l.includes('待收货') || l.includes('待付款'));
            if (statusIdx >= 0 && lines[statusIdx + 1]) {
              title = lines[statusIdx + 1].replace(/\\[交易快照\\]/g, '').trim();
              if (lines[statusIdx + 2] && !lines[statusIdx + 2].match(/^(不支持|申请售后|￥|¥|x\\d|实付款)/)) {
                spec = lines[statusIdx + 2];
              }
            }
            
            const priceMatch = p.match(/[¥￥]([\\d.]+)\\s*\\nx\\d+/);
            if (priceMatch) price = '￥' + priceMatch[1];
            
            parsedOrders.push({
              order_id: orderId,
              order_date: orderDate,
              shop: shopName,
              status: status,
              title: title.slice(0, 120),
              spec: spec.slice(0, 120),
              price: price || total || '￥0',
              total_paid: total || price || '￥0'
            });
          }
          
          return parsedOrders;
        })()
      `);
      
      for (const ord of pageOrders) {
        if (!allOrders.some(existing => existing.order_id === ord.order_id)) {
          allOrders.push(ord);
        }
      }
      
      if (allOrders.length >= limit || p >= maxPages) break;
      
      // Attempt click next page
      const hasNext = await page.evaluate(`
        (() => {
          const nextBtn = document.querySelector('.ant-pagination-next button, .ant-pagination-next .ant-pagination-item-link, .next-pagination-item-link');
          const isDisabled = document.querySelector('.ant-pagination-next')?.classList.contains('ant-pagination-disabled');
          if (nextBtn && !isDisabled) {
            nextBtn.click();
            return true;
          }
          return false;
        })()
      `);
      
      if (!hasNext) break;
      await page.wait(3);
    }
    
    let filtered = allOrders;
    if (query) {
      filtered = filtered.filter(o => 
        o.title.toLowerCase().includes(query) || 
        o.shop.toLowerCase().includes(query) || 
        o.order_id.includes(query) ||
        o.spec.toLowerCase().includes(query)
      );
    }
    
    if (statusFilter) {
      filtered = filtered.filter(o => o.status.includes(statusFilter));
    }
    
    return filtered.slice(0, limit);
  }
});
