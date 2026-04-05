/**
 * Shared helpers for Danjuan (蛋卷基金) adapters.
 *
 * Core design: a single page.evaluate call fetches the gain overview AND
 * all per-account holdings in parallel (Promise.all), minimising Node↔Browser
 * round-trips to exactly one.
 */

import type { IPage } from '@jackwener/opencli/types';

export const DANJUAN_DOMAIN = 'danjuanfunds.com';
export const DANJUAN_ASSET_PAGE = `https://${DANJUAN_DOMAIN}/my-money`;

const GAIN_URL = `https://${DANJUAN_DOMAIN}/djapi/fundx/profit/assets/gain?gains=%5B%22private%22%5D`;
const SUMMARY_URL = `https://${DANJUAN_DOMAIN}/djapi/fundx/profit/assets/summary?invest_account_id=`;

// ---------------------------------------------------------------------------
// Types — keep everything explicit so TS consumers get autocomplete.
// ---------------------------------------------------------------------------

export interface DanjuanAccount {
  accountId: string;
  accountName: string;
  accountType: string;
  accountCode: string;
  marketValue: number | null;
  dailyGain: number | null;
  mainFlag: boolean;
}

export interface DanjuanHolding {
  accountId: string;
  accountName: string;
  accountType: string;
  fdCode: string;
  fdName: string;
  category: string;
  marketValue: number | null;
  volume: number | null;
  usableRemainShare: number | null;
  dailyGain: number | null;
  holdGain: number | null;
  holdGainRate: number | null;
  totalGain: number | null;
  nav: number | null;
  marketPercent: number | null;
}

export interface DanjuanSnapshot {
  asOf: string | null;
  totalAssetAmount: number | null;
  totalAssetDailyGain: number | null;
  totalAssetHoldGain: number | null;
  totalAssetTotalGain: number | null;
  totalFundMarketValue: number | null;
  accounts: DanjuanAccount[];
  holdings: DanjuanHolding[];
}

// ---------------------------------------------------------------------------
// Single-evaluate fetcher
// ---------------------------------------------------------------------------

/**
 * Fetch the complete Danjuan fund picture in ONE browser round-trip.
 *
 * Inside the browser context we:
 *   1. Fetch the gain/assets overview (contains account list)
 *   2. Promise.all → fetch every account's holdings in parallel
 *   3. Return the combined result to Node
 */
export async function fetchDanjuanAll(page: IPage): Promise<DanjuanSnapshot> {
  const raw: any = await page.evaluate(`
    (async () => {
      const f = async (u) => {
        const r = await fetch(u, { credentials: 'include' });
        if (!r.ok) return { _err: r.status };
        try { return await r.json(); } catch { return { _err: 'parse' }; }
      };
      const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };

      const gain = await f(${JSON.stringify(GAIN_URL)});
      if (gain._err) return { _httpError: gain._err };

      const root = gain.data || {};
      const fundSec = (root.items || []).find(i => i && i.summary_type === 'FUND');
      const rawAccs = fundSec && Array.isArray(fundSec.invest_account_list)
        ? fundSec.invest_account_list : [];

      const accounts = rawAccs.map(a => ({
        accountId:   String(a.invest_account_id || ''),
        accountName: a.invest_account_name || '',
        accountType: a.invest_account_type || '',
        accountCode: a.invest_account_code || '',
        marketValue: n(a.market_value),
        dailyGain:   n(a.daily_gain),
        mainFlag:    !!a.main_flag,
      }));

      if (!accounts.length) {
        return { _emptyAccounts: true };
      }

      const details = await Promise.all(
        accounts.map(a => f(${JSON.stringify(SUMMARY_URL)} + encodeURIComponent(a.accountId)))
      );

      const holdings = [];
      const detailErrors = [];
      for (let i = 0; i < accounts.length; i++) {
        const d = details[i];
        if (d._err) {
          detailErrors.push({
            accountId: accounts[i].accountId,
            accountName: accounts[i].accountName,
            error: d._err,
          });
          continue;
        }
        const data = d.data || {};
        const funds = Array.isArray(data.items) ? data.items : [];
        const acc = accounts[i];
        for (const fd of funds) {
          holdings.push({
            accountId:        acc.accountId,
            accountName:      data.invest_account_name || acc.accountName,
            accountType:      data.invest_account_type || acc.accountType,
            fdCode:           fd.fd_code || '',
            fdName:           fd.fd_name || '',
            category:         fd.category_text || fd.category || '',
            marketValue:      n(fd.market_value),
            volume:           n(fd.volume),
            usableRemainShare:n(fd.usable_remain_share),
            dailyGain:        n(fd.daily_gain),
            holdGain:         n(fd.hold_gain),
            holdGainRate:     n(fd.hold_gain_rate),
            totalGain:        n(fd.total_gain),
            nav:              n(fd.nav),
            marketPercent:    n(fd.market_percent),
          });
        }
      }

      return {
        asOf:                root.daily_gain_date || null,
        totalAssetAmount:    n(root.amount),
        totalAssetDailyGain: n(root.daily_gain),
        totalAssetHoldGain:  n(root.hold_gain),
        totalAssetTotalGain: n(root.total_gain),
        totalFundMarketValue:n(fundSec && fundSec.amount),
        accounts,
        holdings,
        detailErrors,
      };
    })()
  `);

  if (raw?._httpError) {
    throw new Error(`HTTP ${raw._httpError} — Hint: not logged in to ${DANJUAN_DOMAIN}?`);
  }
  if (raw?._emptyAccounts) {
    throw new Error(`No fund accounts found — Hint: not logged in to ${DANJUAN_DOMAIN}?`);
  }
  if (Array.isArray(raw?.detailErrors) && raw.detailErrors.length > 0) {
    const failedAccounts = raw.detailErrors
      .map((item: { accountName?: string; accountId?: string; error?: string | number }) => {
        const label = item.accountName && item.accountId
          ? `${item.accountName} (${item.accountId})`
          : item.accountName || item.accountId || 'unknown account';
        return `${label}: ${item.error}`;
      })
      .join(', ');
    throw new Error(`Failed to fetch Danjuan account details: ${failedAccounts}`);
  }
  return raw as DanjuanSnapshot;
}
