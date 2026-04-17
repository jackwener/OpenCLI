import { cli } from '@jackwener/opencli/registry';
import { AuthRequiredError } from '@jackwener/opencli/errors';
import { fetchXueqiuJson } from './utils.js';
cli({
    site: 'xueqiu',
    name: 'hot-stock',
    description: '获取雪球热门股票榜',
    domain: 'xueqiu.com',
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 20, help: '返回数量，默认 20，最大 50' },
        { name: 'type', default: '10', help: '榜单类型 10=人气榜(默认) 12=关注榜' },
    ],
    columns: ['rank', 'symbol', 'name', 'price', 'changePercent', 'heat'],
    func: async (page, kwargs) => {
        await page.goto('https://xueqiu.com');
        const url = `https://stock.xueqiu.com/v5/stock/hot_stock/list.json?size=${kwargs.limit}&type=${kwargs.type}`;
        const d = await fetchXueqiuJson(page, url);
        if (!d.data?.items)
            throw new AuthRequiredError('xueqiu.com');
        return (d.data.items || []).map((s, i) => ({
            rank: i + 1,
            symbol: s.symbol,
            name: s.name,
            price: s.current,
            changePercent: s.percent != null ? s.percent.toFixed(2) + '%' : null,
            heat: s.value,
            url: 'https://xueqiu.com/S/' + s.symbol,
        }));
    },
});
