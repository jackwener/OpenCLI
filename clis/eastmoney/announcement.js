// eastmoney announcement — listed company filings/announcements feed.
//
//   opencli eastmoney announcement
//   opencli eastmoney announcement --market SHA --limit 30

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';

cli({
  site: 'eastmoney',
  name: 'announcement',
  description: '上市公司公告（按交易所筛选）',
  domain: 'np-anotice-stock.eastmoney.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'market', type: 'string', default: 'SHA,SZA,BJA', help: '交易所：SHA (沪) / SZA (深) / BJA (北) 可逗号分隔' },
    { name: 'limit',  type: 'int',    default: 20,            help: '返回数量 (max 100)' },
  ],
  columns: ['time', 'code', 'name', 'title', 'category', 'url'],
  func: async (_page, args) => {
    const market = String(args.market ?? 'SHA,SZA,BJA').trim() || 'SHA,SZA,BJA';
    const limit = Math.max(1, Math.min(Number(args.limit) || 20, 100));

    const url = new URL('https://np-anotice-stock.eastmoney.com/api/security/ann');
    url.searchParams.set('page_size', String(limit));
    url.searchParams.set('page_index', '1');
    url.searchParams.set('ann_type', market);
    url.searchParams.set('client_source', 'web');
    url.searchParams.set('f_node', '0');
    url.searchParams.set('s_node', '0');

    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!resp.ok) throw new CliError('HTTP_ERROR', `announcement failed: HTTP ${resp.status}`);
    const data = await resp.json();
    const list = Array.isArray(data?.data?.list) ? data.data.list : [];
    if (list.length === 0) throw new CliError('NO_DATA', 'eastmoney returned no announcement data');

    return list.slice(0, limit).map((it) => {
      const primary = Array.isArray(it.codes) && it.codes.length > 0 ? it.codes[0] : {};
      const cat = Array.isArray(it.columns) && it.columns.length > 0 ? it.columns[0]?.column_name : '';
      return {
        time: String(it.notice_date || it.display_time || '').slice(0, 19),
        code: primary.stock_code || '',
        name: primary.short_name || '',
        title: it.title || it.title_ch || '',
        category: cat || '',
        url: `https://data.eastmoney.com/notices/detail/${primary.stock_code || ''}/${it.art_code || ''}.html`,
      };
    });
  },
});
