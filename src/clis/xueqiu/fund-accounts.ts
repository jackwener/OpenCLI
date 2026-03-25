import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { DANJUAN_DOMAIN, DANJUAN_ASSET_PAGE, fetchAssetGain, num } from './danjuan-utils.js';

cli({
  site: 'xueqiu',
  name: 'fund-accounts',
  description: '获取雪球基金（蛋卷）子账户汇总信息',
  domain: DANJUAN_DOMAIN,
  strategy: Strategy.COOKIE,
  navigateBefore: DANJUAN_ASSET_PAGE,
  args: [],
  columns: ['accountId', 'accountName', 'accountType', 'marketValue', 'dailyGain', 'remindText'],
  func: async (page: IPage) => {
    const { accounts } = await fetchAssetGain(page);
    if (!accounts.length) {
      throw new Error('No fund accounts found — Hint: not logged in to danjuanfunds.com?');
    }
    return accounts.map((acc: any) => ({
      accountId: acc.invest_account_id,
      accountName: acc.invest_account_name,
      accountType: acc.invest_account_type,
      marketValue: num(acc.market_value),
      dailyGain: num(acc.daily_gain),
      remindText: acc.remind_text ?? '',
      mainFlag: !!acc.main_flag,
    }));
  },
});
