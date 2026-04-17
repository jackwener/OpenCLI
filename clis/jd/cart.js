import { AuthRequiredError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'jd',
    name: 'cart',
    description: '查看京东购物车',
    domain: 'cart.jd.com',
    strategy: Strategy.COOKIE,
    args: [],
    columns: ['index', 'title', 'price', 'quantity', 'sku'],
    navigateBefore: false,
    func: async (page) => {
        await page.goto('https://cart.jd.com/cart_index');
        await page.wait(5);
        const data = await page.evaluate(`
      (async () => {
        const normalize = v => (v || '').replace(/\\s+/g, ' ').trim();
        for (let i = 0; i < 20; i++) {
          if (document.body?.innerText?.length > 500) break;
          await new Promise(r => setTimeout(r, 500));
        }
        const text = document.body?.innerText || '';
        const url = location.href;
        if (text.includes('请登录') || url.includes('passport.jd.com')) {
          return { error: 'auth-required' };
        }

        try {
          const resp = await fetch('https://api.m.jd.com/api?appid=JDC_mall_cart&functionId=pcCart_jc_getCurrentCart&body=%7B%22serInfo%22%3A%7B%22area%22%3A%2222_1930_50948_52157%22%7D%7D', {
            credentials: 'include',
            headers: { referer: 'https://cart.jd.com/' },
          });
          const json = await resp.json();
          const cartData = json?.resultData?.cartInfo?.vendors || [];
          const items = [];
          for (const vendor of cartData) {
            const sorted = vendor.sorted || [];
            for (const item of sorted) {
              const product = item.item || item;
              if (!product.Id && !product.skuId) continue;
              items.push({
                index: items.length + 1,
                title: normalize(product.name || product.Name || '').slice(0, 80),
                price: product.price ? '¥' + product.price : '',
                quantity: String(product.num || product.Num || 1),
                sku: String(product.Id || product.skuId || ''),
              });
            }
          }
          if (items.length > 0) return { items };
        } catch {}

        const lines = text.split('\\n').map(l => l.trim()).filter(Boolean);
        const items = [];
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const priceMatch = line.match(/¥([\\d,.]+)/);
          if (priceMatch && i > 0) {
            const title = lines[i - 1];
            if (title && title.length > 5 && title.length < 200 && !title.startsWith('¥')) {
              items.push({
                index: items.length + 1,
                title: title.slice(0, 80),
                price: '¥' + priceMatch[1],
                quantity: '',
                sku: '',
              });
            }
          }
        }
        return { items };
      })()
    `);
        if (data?.error === 'auth-required') {
            throw new AuthRequiredError('jd cart requires a logged-in JD session');
        }
        return Array.isArray(data?.items) ? data.items : [];
    },
});
