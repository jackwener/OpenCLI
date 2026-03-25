import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { DANJUAN_DOMAIN, DANJUAN_ASSET_PAGE, fetchAssetGain, collectHoldings } from './danjuan-utils.js';

cli({
  site: 'xueqiu',
  name: 'fund-holdings',
  description: '获取雪球基金（蛋卷）全部子账户持仓与份额信息（可用 --account 过滤）',
  domain: DANJUAN_DOMAIN,
  strategy: Strategy.COOKIE,
  navigateBefore: DANJUAN_ASSET_PAGE,
  args: [
    { name: 'account', type: 'str', default: '', help: '按子账户名称或 ID 过滤' },
  ],
  columns: ['accountName', 'fdCode', 'fdName', 'marketValue', 'volume', 'usableRemainShare', 'dailyGain', 'holdGain', 'holdGainRate', 'marketPercent'],
  func: async (page: IPage, args) => {
    const filter = String(args.account ?? '').trim();
    const { accounts } = await fetchAssetGain(page);

    const selected = accounts.filter((acc: any) => {
      if (!filter) return true;
      const id = String(acc?.invest_account_id ?? '');
      const name = String(acc?.invest_account_name ?? '');
      return id === filter || name.includes(filter);
    });
    if (!selected.length) {
      throw new Error(
        filter
          ? `No account matched filter: ${filter}`
          : 'No fund accounts found — Hint: not logged in to danjuanfunds.com?',
      );
    }

    const rows = await collectHoldings(page, selected);
    if (!rows.length) throw new Error('No holdings found.');
    return rows;
  },
});
