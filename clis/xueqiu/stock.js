import { cli } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { fetchXueqiuJson } from './utils.js';
function fmtAmount(v) {
    if (v == null)
        return null;
    if (Math.abs(v) >= 1e12)
        return (v / 1e12).toFixed(2) + '万亿';
    if (Math.abs(v) >= 1e8)
        return (v / 1e8).toFixed(2) + '亿';
    if (Math.abs(v) >= 1e4)
        return (v / 1e4).toFixed(2) + '万';
    return String(v);
}
cli({
    site: 'xueqiu',
    name: 'stock',
    description: '获取雪球股票实时行情',
    domain: 'xueqiu.com',
    browser: true,
    args: [
        {
            name: 'symbol',
            required: true,
            positional: true,
            help: '股票代码，如 SH600519、SZ000858、AAPL、00700',
        },
    ],
    columns: ['name', 'symbol', 'price', 'changePercent', 'marketCap'],
    func: async (page, kwargs) => {
        await page.goto('https://xueqiu.com');
        const symbol = String(kwargs.symbol).toUpperCase();
        const url = `https://stock.xueqiu.com/v5/stock/batch/quote.json?symbol=${encodeURIComponent(symbol)}`;
        const d = await fetchXueqiuJson(page, url);
        if (!d.data?.items?.length)
            throw new EmptyResultError('xueqiu/stock', '请确认股票代码是否正确: ' + symbol);
        const item = d.data.items[0];
        const q = item.quote || {};
        const m = item.market || {};
        return [{
                name: q.name,
                symbol: q.symbol,
                exchange: q.exchange,
                currency: q.currency,
                price: q.current,
                change: q.chg,
                changePercent: q.percent != null ? q.percent.toFixed(2) + '%' : null,
                open: q.open,
                high: q.high,
                low: q.low,
                prevClose: q.last_close,
                amplitude: q.amplitude != null ? q.amplitude.toFixed(2) + '%' : null,
                volume: q.volume,
                amount: fmtAmount(q.amount),
                turnover_rate: q.turnover_rate != null ? q.turnover_rate.toFixed(2) + '%' : null,
                marketCap: fmtAmount(q.market_capital),
                floatMarketCap: fmtAmount(q.float_market_capital),
                ytdPercent: q.current_year_percent != null ? q.current_year_percent.toFixed(2) + '%' : null,
                market_status: m.status || null,
                time: q.timestamp ? new Date(q.timestamp).toISOString() : null,
                url: 'https://xueqiu.com/S/' + q.symbol,
            }];
    },
});
