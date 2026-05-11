import { cli } from '@jackwener/opencli/registry';
import { fetchXueqiuJson } from './utils.js';
cli({
    site: 'xueqiu',
    name: 'search',
    access: 'read',
    description: '搜索雪球股票（代码或名称）',
    domain: 'xueqiu.com',
    browser: true,
    args: [
        { name: 'query', required: true, positional: true, help: '搜索关键词，如 茅台、AAPL、腾讯' },
        { name: 'limit', type: 'int', default: 10, help: '返回数量，默认 10' },
    ],
    columns: ['symbol', 'name', 'exchange', 'price', 'changePercent', 'url'],
    func: async (page, kwargs) => {
        await page.goto('https://xueqiu.com');
        const url = `https://xueqiu.com/stock/search.json?code=${encodeURIComponent(String(kwargs.query))}&size=${kwargs.limit}`;
        const d = await fetchXueqiuJson(page, url);
        return (d.stocks || []).slice(0, kwargs.limit).map((s) => {
            let symbol = '';
            if (s.exchange === 'SH' || s.exchange === 'SZ' || s.exchange === 'BJ') {
                symbol = s.code.startsWith(s.exchange) ? s.code : s.exchange + s.code;
            }
            else {
                symbol = s.code;
            }
            return {
                symbol,
                name: s.name,
                exchange: s.exchange,
                price: s.current,
                changePercent: s.percentage != null ? s.percentage.toFixed(2) + '%' : null,
                url: 'https://xueqiu.com/S/' + symbol,
            };
        });
    },
});
