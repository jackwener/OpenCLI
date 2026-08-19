import { cli, Strategy } from '@jackwener/opencli/registry';
import { GPU_COST_MINUTES } from './capabilities.js';
import {
  creditsToFastMinutes,
  getMidjourneyAccount,
  isoFromMillis,
  numberOrNull,
  readQuotaTrend,
  recordQuotaSnapshot,
} from './utils.js';

cli({
  site: 'midjourney',
  name: 'quota',
  aliases: ['account'],
  description: 'Show Midjourney quota, conservative batch estimates, and account-consumption trend',
  access: 'read',
  example: 'opencli midjourney quota -f yaml',
  domain: 'www.midjourney.com',
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  navigateBefore: 'https://www.midjourney.com/imagine',
  args: [],
  columns: [
    'plan', 'period_end', 'allocated_minutes', 'used_minutes', 'remaining_minutes', 'used_pct', 'days_remaining',
    'avg_daily_minutes', 'projected_exhaustion_date', 'sd_batches_remaining', 'hd_batches_remaining', 'omni_batches_remaining',
  ],
  func: async (page) => {
    const account = await getMidjourneyAccount(page);
    await recordQuotaSnapshot(account, 'quota');
    const trend = await readQuotaTrend(account);
    const remainingCredits = numberOrNull(account.total_credits ?? account.credits_total);
    const usedCredits = numberOrNull(account.period_credits_used ?? account.credit_period_usage);
    const remainingMinutes = creditsToFastMinutes(remainingCredits);
    const usedMinutes = creditsToFastMinutes(usedCredits);
    const allocatedMinutes = remainingMinutes == null || usedMinutes == null
      ? null
      : Number((remainingMinutes + usedMinutes).toFixed(2));
    const periodEnd = isoFromMillis(account.billing_period?.end);
    const daysRemaining = periodEnd
      ? Math.max(0, Number(((Date.parse(periodEnd) - Date.now()) / 86_400_000).toFixed(2)))
      : null;
    const batches = (cost) => remainingMinutes == null ? null : Math.floor(remainingMinutes / cost);
    return [{
      plan: account.plan?.type || null,
      period_end: periodEnd,
      allocated_minutes: allocatedMinutes,
      used_minutes: usedMinutes,
      remaining_minutes: remainingMinutes,
      used_pct: allocatedMinutes > 0 && usedMinutes != null ? Number(((usedMinutes / allocatedMinutes) * 100).toFixed(2)) : null,
      days_remaining: daysRemaining,
      avg_daily_minutes: trend.avgDailyMinutes,
      projected_exhaustion_date: trend.projectedExhaustionDate,
      sd_batches_remaining: batches(GPU_COST_MINUTES.imageSd),
      hd_batches_remaining: batches(GPU_COST_MINUTES.imageHd),
      omni_batches_remaining: batches(GPU_COST_MINUTES.omni),
    }];
  },
});
