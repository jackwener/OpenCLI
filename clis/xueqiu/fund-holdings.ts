import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/types';
import { fetchDanjuanAll } from './danjuan-utils.js';

cli({
  site: 'xueqiu',
  name: 'fund-holdings',
  description: '获取蛋卷基金持仓明细（可用 --account 按子账户过滤）',
  domain: 'danjuanfunds.com',
  strategy: Strategy.COOKIE,
  navigateBefore: 'https://danjuanfunds.com/my-money',
  args: [
    { name: 'account', type: 'str', default: '', help: '按子账户名称或 ID 过滤' },
  ],
  columns: ['accountName', 'fdCode', 'fdName', 'marketValue', 'volume', 'dailyGain', 'holdGain', 'holdGainRate', 'marketPercent'],
  func: async (page: IPage, args) => {
    const snapshot = await fetchDanjuanAll(page);
    if (!snapshot.accounts.length) {
      throw new Error('No fund accounts found — Hint: not logged in to danjuanfunds.com?');
    }

    const filter = String(args.account ?? '').trim();
    const rows = filter
      ? snapshot.holdings.filter(h => h.accountId === filter || h.accountName.includes(filter))
      : snapshot.holdings;

    if (!rows.length) {
      throw new Error(filter ? `No holdings matched account filter: ${filter}` : 'No holdings found.');
    }
    return rows;
  },
});
