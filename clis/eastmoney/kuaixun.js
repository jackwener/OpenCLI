// eastmoney kuaixun — 7x24 real-time market news feed.
//
//   opencli eastmoney kuaixun
//   opencli eastmoney kuaixun --column 102 --limit 30

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';

// Known columns on eastmoney 7x24:
//   102 = 重要 (default)
//   101 = 全部
//   104 = 公司
//   105 = 市场
//   106 = 机构
//   107 = 宏观

cli({
  site: 'eastmoney',
  name: 'kuaixun',
    access: 'read',
  description: '东方财富 7x24 财经快讯',
  domain: 'np-listapi.eastmoney.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'column', type: 'string', default: '102', help: '频道：102 (重要) / 101 (全部) / 104 / 105 / 106 / 107' },
    { name: 'limit',  type: 'int',    default: 20,    help: '返回数量 (max 100)' },
  ],
  columns: ['time', 'title', 'summary', 'stocks'],
  func: async (args) => {
    const column = String(args.column ?? '102').trim();
    const limit = Math.max(1, Math.min(Number(args.limit) || 20, 100));

    const url = new URL('https://np-listapi.eastmoney.com/comm/web/getFastNewsList');
    url.searchParams.set('client', 'web');
    url.searchParams.set('biz', 'web_724');
    url.searchParams.set('fastColumn', column);
    url.searchParams.set('sortEnd', '');
    url.searchParams.set('pageSize', String(limit));
    url.searchParams.set('req_trace', '1');

    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
    if (!resp.ok) throw new CliError('HTTP_ERROR', `kuaixun failed: HTTP ${resp.status}`);
    const data = await resp.json();
    const list = Array.isArray(data?.data?.fastNewsList) ? data.data.fastNewsList : [];
    if (list.length === 0) throw new CliError('NO_DATA', 'eastmoney returned no kuaixun data');

    return list.slice(0, limit).map((it) => ({
      time: it.showTime,
      title: it.title,
      summary: (it.summary || '').replace(/\s+/g, ' ').slice(0, 400),
      stocks: Array.isArray(it.stockList) ? it.stockList.join(', ') : '',
    }));
  },
});
