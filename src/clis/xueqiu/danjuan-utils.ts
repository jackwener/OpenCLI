/**
 * Shared helpers for Danjuan (蛋卷基金) adapters.
 *
 * Provides cookie-authenticated API access via browser page.evaluate,
 * asset/gain data fetching, and holdings collection.
 */

import type { IPage } from '../../types.js';

export const DANJUAN_DOMAIN = 'danjuanfunds.com';
export const DANJUAN_ASSET_PAGE = `https://${DANJUAN_DOMAIN}/my-money`;

/** Safe numeric coercion — returns null for non-finite values. */
export function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Fetch JSON from a Danjuan API endpoint via browser page.evaluate. */
export async function fetchDanjuanApi(page: IPage, url: string): Promise<any> {
  const data = await page.evaluate(`
    (async () => {
      const resp = await fetch(${JSON.stringify(url)}, { credentials: 'include' });
      if (!resp.ok) return { _httpError: resp.status };
      try { return await resp.json(); }
      catch { return { _httpError: 'JSON parse error (status ' + resp.status + ')' }; }
    })()
  `);
  if (data?._httpError) {
    throw new Error(`HTTP ${data._httpError} — Hint: not logged in to ${DANJUAN_DOMAIN}?`);
  }
  return data;
}

/** Fetch the top-level asset/gain data and extract fund accounts list. */
export async function fetchAssetGain(page: IPage) {
  const gain = await fetchDanjuanApi(
    page,
    `https://${DANJUAN_DOMAIN}/djapi/fundx/profit/assets/gain?gains=%5B%22private%22%5D`,
  );
  const root = gain?.data ?? {};
  const fundSection = (Array.isArray(root.items) ? root.items : [])
    .find((item: any) => item?.summary_type === 'FUND');
  const accounts: any[] = Array.isArray(fundSection?.invest_account_list)
    ? fundSection.invest_account_list
    : [];
  return { root, fundSection, accounts };
}

/** Fetch per-account holdings detail. */
export async function fetchAccountSummary(page: IPage, accountId: string): Promise<any> {
  return fetchDanjuanApi(
    page,
    `https://${DANJUAN_DOMAIN}/djapi/fundx/profit/assets/summary?invest_account_id=${encodeURIComponent(accountId)}`,
  );
}

/** Map a raw fund item + account context into a standardised holdings row. */
export function toHoldingRow(fund: any, accountId: string, accountName: string, accountType: string) {
  return {
    accountId,
    accountName,
    accountType,
    fdCode: fund.fd_code ?? '',
    fdName: fund.fd_name ?? '',
    category: fund.category ?? '',
    categoryText: fund.category_text ?? '',
    marketValue: num(fund.market_value),
    volume: num(fund.volume),
    usableRemainShare: num(fund.usable_remain_share),
    dailyGain: num(fund.daily_gain),
    dailyGainDate: fund.daily_gain_date ?? null,
    holdGain: num(fund.hold_gain),
    holdGainRate: num(fund.hold_gain_rate),
    totalGain: num(fund.total_gain),
    totalGainRate: num(fund.total_gain_rate),
    nav: num(fund.nav),
    navDate: fund.nav_date ?? null,
    marketPercent: num(fund.market_percent),
  };
}

/** Collect holdings for a set of accounts. */
export async function collectHoldings(page: IPage, accounts: any[]) {
  const rows: ReturnType<typeof toHoldingRow>[] = [];
  for (const acc of accounts) {
    const accountId = String(acc?.invest_account_id ?? '');
    const detail = await fetchAccountSummary(page, accountId);
    const data = detail?.data ?? {};
    const funds: any[] = Array.isArray(data.items) ? data.items : [];
    for (const fund of funds) {
      rows.push(toHoldingRow(
        fund,
        accountId,
        data.invest_account_name || acc.invest_account_name || '',
        data.invest_account_type || acc.invest_account_type || '',
      ));
    }
  }
  return rows;
}
