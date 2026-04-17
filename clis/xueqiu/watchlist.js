import { cli } from '@jackwener/opencli/registry';
import { AuthRequiredError } from '@jackwener/opencli/errors';
import { fetchXueqiuJson } from './utils.js';
cli({
    site: 'xueqiu',
    name: 'watchlist',
    description: '获取雪球自选股/模拟组合股票列表',
    domain: 'xueqiu.com',
    browser: true,
    args: [
        {
            name: 'pid',
            default: '-1',
            help: '分组ID：-1=全部(默认) -4=模拟 -5=沪深 -6=美股 -7=港股 -10=实盘 0=持仓（通过 xueqiu groups 获取）',
        },
        { name: 'limit', type: 'int', default: 100, help: '默认 100' },
    ],
    columns: ['symbol', 'name', 'price', 'changePercent'],
    func: async (page, kwargs) => {
        await page.goto('https://xueqiu.com');
        const pid = String(kwargs.pid || '-1');
        const url = `https://stock.xueqiu.com/v5/stock/portfolio/stock/list.json?size=100&category=1&pid=${encodeURIComponent(pid)}`;
        const d = await fetchXueqiuJson(page, url);
        if (!d.data?.stocks)
            throw new AuthRequiredError('xueqiu.com');
        return (d.data.stocks || []).slice(0, kwargs.limit).map((s) => ({
            symbol: s.symbol,
            name: s.name,
            price: s.current,
            change: s.chg,
            changePercent: s.percent != null ? s.percent.toFixed(2) + '%' : null,
            volume: s.volume,
            url: 'https://xueqiu.com/S/' + s.symbol,
        }));
    },
});
