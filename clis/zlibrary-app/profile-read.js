/**
 * Z-Library Desktop profile-read command.
 *
 * Displays account info, daily download quota, and MD5 filename format status
 * by extracting data from:
 *   - /users/downloads → quota data (daily used/limit/remaining, reset text)
 *   - /profileEdit → username, account tier, filename format template
 *
 * Data sources:
 *   - Quota: `.dstats-info .d-count` → used/limit, `.dstats-info .d-reset` → reset text
 *   - Username: `.navigation-user-card-element .user-card__name a` → textContent
 *   - Account Tier: `.navigation-user-card-element .user-card__status .profile-header__status` → textContent
 *   - Filename format: `#download-filename-format` on /profileEdit → textContent
 *
 * URL Security Boundary:
 *   - Internal: relative URLs (/users/downloads, /profileEdit)
 *   - Output: plain text field/value pairs (no URLs in output)
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { extractQuotaFromDom, parseResetTextToAbsolute } from './_shared/quota/checker.js';
import { QuotaLedger } from './_shared/quota/ledger.js';
import { acquireLockOrThrow } from './_shared/infra/pid-lock.js';
import { hasMd5InFilenameFormat } from './_shared/infra/md5-format.js';
import { getCurrentHttpOrigin, assertSameOriginNotLoginWall } from './_shared/infra/url-boundary.js';

/**
 * Extract profile info and filename format from /profileEdit page.
 *
 * Navigates to /profileEdit and extracts username, account tier,
 * and filename format template in a single DOM extraction.
 *
 * The /profileEdit page contains all tabs — filename format
 * (#download-filename-format) is available here, no need for sub-pages.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @returns {Promise<{ username: string, accountTier: string, navCardElement: string, filenameFormat: string }>}
 * @throws {Error} If navigation fails or login wall detected
 */
// Design Note: Doctor probes and read commands share this snapshot extractor
// so profile selectors have one production owner.
export async function extractProfileSnapshotFromDom(page) {
  const startOrigin = await getCurrentHttpOrigin(page);

  // Navigate to /profileEdit (relative URL internally, absolute for CDP)
  const profileUrl = new URL('/profileEdit', startOrigin.origin).href;
  await page.goto(profileUrl, { waitUntil: 'load', settleMs: 3000 });

  // Validate same-origin and not login wall after navigation
  await assertSameOriginNotLoginWall(page, startOrigin, 'zlibrary-app profile');

  return extractProfileSnapshotFromCurrentDom(page);
}

async function extractProfileFromDom(page) {
  const snapshot = await extractProfileSnapshotFromDom(page);

  return {
    username: snapshot.username || '',
    accountTier: snapshot.accountTier || '',
    filenameFormatText: snapshot.filenameFormat || '',
  };
}

async function extractProfileSnapshotFromCurrentDom(page) {
  const profileData = await page.evaluate(`(() => {
    const result = { username: '', accountTier: '', navCardElement: 'not found', filenameFormat: '' };

    // Nav card: username + account tier
    const navCard = document.querySelector('.navigation-user-card-element');
    if (navCard) {
      const nameEl = navCard.querySelector('.user-card__name a');
      if (nameEl) result.username = nameEl.textContent.trim();

      const statusEl = navCard.querySelector('.user-card__status .profile-header__status');
      if (statusEl) result.accountTier = statusEl.textContent.trim();

      result.navCardElement = 'found';
    }

    // Filename format: desugar tag spans back to template variables via DOM API
    const ffEl = document.querySelector('#download-filename-format');
    if (ffEl) {
      // Clone to avoid mutating the live contenteditable
      var clone = ffEl.cloneNode(true);
      // Replace each <span id="tag_Name"> with a {name} text node
      var tagSpans = clone.querySelectorAll('span[id^="tag_"]');
      for (var i = 0; i < tagSpans.length; i++) {
        var name = tagSpans[i].id.replace('tag_', '').toLowerCase();
        tagSpans[i].parentNode.replaceChild(document.createTextNode('{' + name + '}'), tagSpans[i]);
      }
      // textContent strips all remaining HTML; clean UI-only whitespace
      var text = clone.textContent || '';
      text = text.replace(/\\u200A/g, '').replace(/\\u00A0/g, ' ').trim();
      result.filenameFormat = text;
    }

    return result;
  })()`);

  return normalizeProfileSnapshotPayload(profileData);
}

function normalizeProfileSnapshotPayload(profileData) {
  const data = profileData && typeof profileData === 'object' ? profileData : {};
  const username = data.username || '';
  const accountTier = data.accountTier || '';
  const filenameFormat = data.filenameFormat || '';
  const navCardElement = data.navCardElement || '';

  return {
    username: username,
    accountTier: accountTier,
    navCardElement: navCardElement,
    filenameFormat: filenameFormat,
  };
}

export const profileReadCommand = cli({
    site: 'zlibrary-app',
    name: 'profile-read',
    access: 'read',
    description: 'Show Z-Library account info, daily download quota, and MD5 filename format status',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    columns: ['field', 'value'],
    func: async (page) => {
        const lock = await acquireLockOrThrow('zlibrary-app profile-read');
        try {
        // Path 1: Quota from /users/downloads (unchanged)
        let quota;
        try {
            quota = await extractQuotaFromDom(page);
        } catch (error) {
            quota = {
                dailyUsed: null,
                dailyLimit: null,
                dailyRemaining: null,
                resetText: null,
                progressAriaNow: null,
                filenameFormatText: '',
            };
        }

        // Path 2: Profile info + filename format from /profileEdit (single page, single evaluate)
        let userInfo = { username: '', accountTier: '', filenameFormatText: '' };
        try {
            userInfo = await extractProfileFromDom(page);
        } catch (error) {
            // keep the empty-user fallback
        }

        // Build result rows
        const rows = [];

        // Account section
        rows.push({ field: 'Username', value: userInfo.username || '(not found)' });
        rows.push({ field: 'Account Tier', value: userInfo.accountTier || '(not found)' });

        // MD5 Filename Format section (after account, before quota)
        const md5Enabled = hasMd5InFilenameFormat(userInfo.filenameFormatText);

        rows.push({ field: 'MD5 Filename Format', value: md5Enabled ? 'enabled' : 'disabled' });
        rows.push({ field: 'Filename Format', value: userInfo.filenameFormatText || '(not found)' });

        // Quota section
        if (quota.dailyUsed !== null && quota.dailyLimit !== null) {
            rows.push({ field: 'Daily Used', value: String(quota.dailyUsed) });
            rows.push({ field: 'Daily Limit', value: String(quota.dailyLimit) });
            rows.push({ field: 'Daily Remaining', value: String(quota.dailyRemaining) });
        } else {
            rows.push({ field: 'Daily Quota', value: 'Unknown (DOM not found)' });
        }

        if (quota.resetText) {
            rows.push({ field: 'Reset In', value: quota.resetText });
        }

        if (quota.progressAriaNow !== null && !Number.isNaN(quota.progressAriaNow)) {
            rows.push({ field: 'Usage (%)', value: quota.progressAriaNow + '%' });
        }

        // -- Ledger quota section --
        const ledger = new QuotaLedger();
        const existing = ledger.load();

        if (!existing && quota.dailyLimit != null) {
            ledger.bootstrap(
                quota.dailyLimit,
                parseResetTextToAbsolute(quota.resetText || ''),
            );
            if (quota.dailyUsed != null) {
                ledger.setDomUsed(quota.dailyUsed);
            }
            ledger.save();
        } else if (quota.dailyUsed != null) {
            ledger.setDomUsed(quota.dailyUsed);
        }

        // Roll over counter if resetAt has passed since last visit
        ledger.ensureResetRollover();

        const stats = ledger.getStats();
        rows.push({ field: '---', value: '---' });

        if (stats.available) {
            rows.push({ field: 'Ledger Daily Limit', value: String(stats.dailyLimit) });
            rows.push({ field: 'Ledger Downloaded Today', value: String(stats.downloadedToday) });
            rows.push({ field: 'Ledger Remaining', value: String(stats.remaining) });
            rows.push({ field: 'Ledger Date', value: stats.date || '(none)' });
            if (stats.resetAt) {
                rows.push({ field: 'Ledger Reset At', value: stats.resetAt });
            }
            rows.push({ field: 'Ledger Updated At', value: stats.updatedAt || '(none)' });
        } else {
            rows.push({ field: 'Ledger', value: 'Not available (no ledger file)' });
        }

        return rows;
    } finally {
        await lock.release();
    }
  },
});
