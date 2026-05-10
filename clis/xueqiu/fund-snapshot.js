import { cli, Strategy } from '@jackwener/opencli/registry';
import { fetchDanjuanAll } from './danjuan-utils.js';
cli({
    site: 'xueqiu',
    name: 'fund-snapshot',
    access: 'read',
    description: '获取蛋卷基金快照（总资产、子账户、持仓，推荐 -f json 输出）',
    domain: 'danjuanfunds.com',
    strategy: Strategy.COOKIE,
    navigateBefore: 'https://danjuanfunds.com/my-money',
    args: [],
    columns: ['asOf', 'totalAssetAmount', 'totalFundMarketValue', 'accountCount', 'holdingCount'],
    func: async (page) => {
        const s = await fetchDanjuanAll(page);
        return [{
                asOf: s.asOf,
                totalAssetAmount: s.totalAssetAmount,
                totalAssetDailyGain: s.totalAssetDailyGain,
                totalFundMarketValue: s.totalFundMarketValue,
                accountCount: s.accounts.length,
                holdingCount: s.holdings.length,
                accounts: s.accounts,
                holdings: s.holdings,
            }];
    },
});
