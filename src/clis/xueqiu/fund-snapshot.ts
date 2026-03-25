import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { DANJUAN_DOMAIN, DANJUAN_ASSET_PAGE, fetchAssetGain, collectHoldings, num } from './danjuan-utils.js';

cli({
  site: 'xueqiu',
  name: 'fund-snapshot',
  description: '获取雪球基金（蛋卷）当前快照（总资产、子账户、持仓明细）',
  domain: DANJUAN_DOMAIN,
  strategy: Strategy.COOKIE,
  navigateBefore: DANJUAN_ASSET_PAGE,
  args: [],
  columns: ['asOf', 'totalAssetAmount', 'totalFundMarketValue', 'accountCount', 'holdingCount'],
  func: async (page: IPage) => {
    const { root, fundSection, accounts } = await fetchAssetGain(page);
    const holdings = await collectHoldings(page, accounts);

    return [{
      asOf: root.daily_gain_date ?? null,
      totalAssetAmount: num(root.amount),
      totalAssetDailyGain: num(root.daily_gain),
      totalAssetHoldGain: num(root.hold_gain),
      totalAssetTotalGain: num(root.total_gain),
      totalFundMarketValue: num(fundSection?.amount),
      accountCount: accounts.length,
      holdingCount: holdings.length,
      accounts,
      holdings,
    }];
  },
});
