// eastmoney holders — top-10 float shareholders of an A-share (F10 data).
//
//   opencli eastmoney holders 600519
//   opencli eastmoney holders sh600519 --limit 10

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';

/**
 * Convert a bare A-share symbol to eastmoney's SECUCODE form ("600519.SH").
 * Accepts "600519", "sh600519", "sz000001", "bj430047", or full "600519.SH".
 * @param {string} input
 * @returns {string}
 */
function toSecucode(input) {
  const raw = String(input || '').trim().toUpperCase();
  if (/^\d{6}\.(SH|SZ|BJ)$/.test(raw)) return raw;
  const pref = raw.match(/^(SH|SZ|BJ)(\d{6})$/);
  if (pref) return `${pref[2]}.${pref[1]}`;
  if (/^\d{6}$/.test(raw)) {
    if (/^(60|68|90|113|900)/.test(raw)) return `${raw}.SH`;
    if (/^(4|8|920|83|87)/.test(raw))    return `${raw}.BJ`;
    return `${raw}.SZ`;
  }
  throw new Error(`Unrecognized A-share symbol: ${input}`);
}

cli({
  site: 'eastmoney',
  name: 'holders',
    access: 'read',
  description: '十大流通股东（A股 F10 数据）',
  domain: 'datacenter-web.eastmoney.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'symbol', required: true, positional: true, help: 'A股代码（600519 / sh600519 等）' },
    { name: 'limit',  type: 'int',    default: 10,      help: '返回股东数（默认十大流通股东）' },
  ],
  columns: ['rank', 'reportDate', 'name', 'holdNum', 'floatRatio', 'change'],
  func: async (args) => {
    /** @type {string} */
    let secucode;
    try { secucode = toSecucode(args.symbol); }
    catch (err) { throw new CliError('INVALID_ARGUMENT', `${err instanceof Error ? err.message : err}`); }
    const limit = Math.max(1, Math.min(Number(args.limit) || 10, 50));

    const url = new URL('https://datacenter-web.eastmoney.com/api/data/v1/get');
    url.searchParams.set('sortColumns', 'END_DATE,HOLDER_RANK');
    url.searchParams.set('sortTypes', '-1,1');
    url.searchParams.set('pageSize', String(Math.max(limit, 10)));
    url.searchParams.set('pageNumber', '1');
    url.searchParams.set('reportName', 'RPT_F10_EH_FREEHOLDERS');
    url.searchParams.set('columns', 'SECUCODE,SECURITY_CODE,END_DATE,HOLDER_RANK,HOLDER_NAME,HOLD_NUM,FREE_HOLDNUM_RATIO,HOLD_NUM_CHANGE');
    url.searchParams.set('source', 'HSF10');
    url.searchParams.set('client', 'PC');
    url.searchParams.set('filter', `(SECUCODE="${secucode}")`);

    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!resp.ok) throw new CliError('HTTP_ERROR', `holders failed: HTTP ${resp.status}`);
    const data = await resp.json();
    const rows = Array.isArray(data?.result?.data) ? data.result.data : [];
    if (rows.length === 0) throw new CliError('NO_DATA', `No shareholder data for ${secucode}`);

    // Only the most recent reporting period
    const latest = String(rows[0].END_DATE || '').slice(0, 10);
    return rows
      .filter((it) => String(it.END_DATE || '').slice(0, 10) === latest)
      .slice(0, limit)
      .map((it) => ({
        rank: it.HOLDER_RANK,
        reportDate: latest,
        name: it.HOLDER_NAME,
        holdNum: it.HOLD_NUM,
        floatRatio: it.FREE_HOLDNUM_RATIO,
        change: it.HOLD_NUM_CHANGE,
      }));
  },
});
