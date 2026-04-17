import { cli } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { fetchXueqiuJson } from './utils.js';
cli({
    site: 'xueqiu',
    name: 'kline',
    description: '获取雪球股票K线（历史行情）数据',
    domain: 'xueqiu.com',
    browser: true,
    args: [
        {
            name: 'symbol',
            required: true,
            positional: true,
            help: '股票代码，如 SH600519、SZ000858、AAPL',
        },
        { name: 'days', type: 'int', default: 14, help: '回溯天数（默认14天）' },
    ],
    columns: ['date', 'open', 'high', 'low', 'close', 'volume'],
    func: async (page, kwargs) => {
        await page.goto('https://xueqiu.com');
        const symbol = String(kwargs.symbol).toUpperCase();
        const days = kwargs.days;
        const beginTs = Date.now();
        const url = `https://stock.xueqiu.com/v5/stock/chart/kline.json?symbol=${encodeURIComponent(symbol)}&begin=${beginTs}&period=day&type=before&count=-${days}`;
        const d = await fetchXueqiuJson(page, url);
        if (!d.data?.item?.length)
            throw new EmptyResultError('xueqiu/kline', '请确认股票代码是否正确: ' + symbol);
        const columns = d.data.column || [];
        const colIdx = {};
        columns.forEach((name, i) => { colIdx[name] = i; });
        return d.data.item.map(row => ({
            date: colIdx.timestamp != null ? new Date(row[colIdx.timestamp]).toISOString().split('T')[0] : null,
            open: row[colIdx.open] ?? null,
            high: row[colIdx.high] ?? null,
            low: row[colIdx.low] ?? null,
            close: row[colIdx.close] ?? null,
            volume: row[colIdx.volume] ?? null,
            percent: row[colIdx.percent] ?? null,
            symbol,
        }));
    },
});
