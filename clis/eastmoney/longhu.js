// eastmoney longhu — dragon & tiger list (龙虎榜).
//
//   opencli eastmoney longhu
//   opencli eastmoney longhu --date 2025-12-10 --limit 20

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';

function defaultTradeDate() {
  // Default window = 30 days back; results sorted DESC so latest comes first.
  // This avoids missing data on weekends/holidays when "yesterday" had no trading.
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  d.setUTCDate(d.getUTCDate() - 30);
  return d.toISOString().slice(0, 10);
}

cli({
  site: 'eastmoney',
  name: 'longhu',
  description: '龙虎榜明细（A股交易所公开披露榜单）',
  domain: 'datacenter-web.eastmoney.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'date',  type: 'string', default: '',  help: '开始交易日 YYYY-MM-DD (默认昨天)' },
    { name: 'limit', type: 'int',    default: 20,  help: '返回数量 (max 100)' },
  ],
  columns: ['tradeDate', 'code', 'name', 'closePrice', 'changeRate', 'boardAmt', 'buyAmt', 'sellAmt', 'netAmt', 'turnover', 'dealRatio', 'market', 'reason'],
  func: async (_page, args) => {
    const sinceDate = String(args.date || '').trim() || defaultTradeDate();
    const limit = Math.max(1, Math.min(Number(args.limit) || 20, 100));

    const url = new URL('https://datacenter-web.eastmoney.com/api/data/v1/get');
    url.searchParams.set('sortColumns', 'TRADE_DATE,SECURITY_CODE');
    url.searchParams.set('sortTypes', '-1,1');
    url.searchParams.set('pageSize', String(limit));
    url.searchParams.set('pageNumber', '1');
    url.searchParams.set('reportName', 'RPT_DAILYBILLBOARD_DETAILS');
    url.searchParams.set('columns', 'ALL');
    url.searchParams.set('source', 'WEB');
    url.searchParams.set('client', 'WEB');
    url.searchParams.set('filter', `(TRADE_DATE>='${sinceDate}')`);

    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!resp.ok) throw new CliError('HTTP_ERROR', `longhu failed: HTTP ${resp.status}`);
    const data = await resp.json();
    /** @type {any[]} */
    const rows = Array.isArray(data?.result?.data) ? data.result.data : [];
    if (rows.length === 0) throw new CliError('NO_DATA', `No longhu data since ${sinceDate}`);

    return rows.slice(0, limit).map((it) => ({
      tradeDate: String(it.TRADE_DATE || '').slice(0, 10),
      code: it.SECURITY_CODE,
      name: it.SECURITY_NAME_ABBR,
      closePrice: it.CLOSE_PRICE,
      changeRate: it.CHANGE_RATE,
      boardAmt: it.BILLBOARD_DEAL_AMT,
      buyAmt: it.BILLBOARD_BUY_AMT,
      sellAmt: it.BILLBOARD_SELL_AMT,
      netAmt: it.BILLBOARD_NET_AMT,
      turnover: it.ACCUM_AMOUNT,
      dealRatio: it.DEAL_AMOUNT_RATIO,
      market: it.TRADE_MARKET,
      reason: it.EXPLANATION,
    }));
  },
});
