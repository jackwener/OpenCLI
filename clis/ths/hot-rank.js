import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const THS_HOT_API = 'https://dq.10jqka.com.cn/fuyao/hot_list_data/out/hot_list/v1/stock?stock_type=a&type=hour&list_type=normal';
const THS_LIST_MAX = 100;

/**
 * Format the raw heat value ("1750902.0") into the "175.1万热度" style the
 * rendered page shows, so output stays compatible with the previous adapter.
 */
function formatHeat(rate) {
  const n = Number(rate);
  if (!Number.isFinite(n) || n <= 0) return '';
  const wan = n / 10000;
  // One decimal, drop the trailing ".0" for whole numbers (matches the page).
  const rounded = Math.round(wan * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text}万热度`;
}

/** Format a percentage like -1.6667 -> "-1.67%". */
function formatPercent(value) {
  if (value === null || value === undefined || value === '' || Number.isNaN(Number(value))) return '';
  const n = Number(value);
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

function mapRow(item) {
  const concept = item?.tag?.concept_tag;
  const popularity = item?.tag?.popularity_tag;
  const tags = [popularity, ...(Array.isArray(concept) ? concept : [])]
    .filter((t) => typeof t === 'string' && t.trim())
    .join(',');
  return {
    rank: item?.order,
    symbol: item?.code ? String(item.code) : '',
    name: item?.name ?? '',
    changePercent: formatPercent(item?.rise_and_fall),
    heat: formatHeat(item?.rate),
    tags,
  };
}

cli({
  site: 'ths',
  name: 'hot-rank',
  access: 'read',
  description: '同花顺热股榜',
  domain: 'dq.10jqka.com.cn',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'limit', type: 'int', default: 20, help: '返回数量 (1-100)' },
  ],
  columns: ['rank', 'symbol', 'name', 'changePercent', 'heat', 'tags'],
  func: async (kwargs, _debug) => {
    const limit = Math.max(1, Math.min(THS_LIST_MAX, Number(kwargs?.limit) || 20));

    let resp;
    try {
      resp = await fetch(THS_HOT_API, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'application/json',
          Referer: 'https://eq.10jqka.com.cn/',
        },
      });
    } catch (error) {
      throw new CommandExecutionError(`ths hot-rank request failed: ${error?.message || error}`);
    }
    if (!resp.ok) {
      throw new CommandExecutionError(`ths hot-rank failed: HTTP ${resp.status}`);
    }

    let payload;
    try {
      payload = await resp.json();
    } catch (error) {
      throw new CommandExecutionError(`ths hot-rank returned malformed JSON: ${error?.message || error}`);
    }
    if (payload?.status_code && payload.status_code !== 0) {
      throw new CommandExecutionError(`ths hot-rank returned status_code=${payload.status_code}: ${payload?.status_msg || ''}`);
    }

    const list = Array.isArray(payload?.data?.stock_list) ? payload.data.stock_list : [];
    const rows = list.map(mapRow).filter((r) => r.name).slice(0, limit);
    if (rows.length === 0) {
      throw new EmptyResultError('ths hot-rank', 'Upstream hot_list API returned an empty stock_list.');
    }
    return rows;
  },
});
