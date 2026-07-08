import { cli } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { fetchXueqiuJson, formatChinaDate } from './utils.js';
cli({
    site: 'xueqiu',
    name: 'earnings-date',
    access: 'read',
    description: '获取股票预计财报发布日期（公司大事）',
    domain: 'xueqiu.com',
    browser: true,
    args: [
        {
            name: 'symbol',
            required: true,
            positional: true,
            help: '股票代码，如 SH600519、SZ000858、00700',
        },
        { name: 'next', type: 'bool', default: false, help: '仅返回最近一次未发布的财报日期' },
        { name: 'limit', type: 'int', default: 10, help: '返回数量，默认 10' },
    ],
    columns: ['date', 'report', 'status'],
    func: async (page, kwargs) => {
        await page.goto('https://xueqiu.com');
        const symbol = String(kwargs.symbol).toUpperCase();
        const url = `https://stock.xueqiu.com/v5/stock/screener/event/list.json?symbol=${encodeURIComponent(symbol)}&page=1&size=100`;
        const d = await fetchXueqiuJson(page, url);
        if (!d.data?.items)
            throw new EmptyResultError('xueqiu/earnings-date', '请确认股票代码是否正确: ' + symbol);
        // subtype 2 = 预计财报发布
        const now = Date.now();
        let results = d.data.items
            .filter((item) => item.subtype === 2)
            .map((item) => {
            const ts = item.timestamp;
            const dateStr = ts ? formatChinaDate(ts) : null;
            const isFuture = ts && ts > now;
            return { date: dateStr, report: item.message, status: isFuture ? '⏳ 未发布' : '✅ 已发布', _ts: ts, _future: isFuture };
        });
        if (kwargs.next) {
            const future = results.filter((r) => r._future).sort((a, b) => a._ts - b._ts);
            results = future.length ? [future[0]] : [];
        }
        return results.slice(0, kwargs.limit).map(({ date, report, status }) => ({ date, report, status }));
    },
});
