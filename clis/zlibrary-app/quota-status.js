/**
 * Z-Library Desktop quota-status command.
 *
 * Displays daily download quota from both the persistent quota ledger
 * and the current DOM state on /users/downloads.
 *
 * Data sources:
 *   - DOM: live quota display (d-count, d-reset elements)
 *   - Ledger: persistent ~/.opencli/sites/zlibrary-app/quota-ledger.json
 *
 * URL Security Boundary:
 *   - Internal: relative URL (/users/downloads) — handled by extractQuotaFromDom
 *   - Output: plain text field/value pairs (no URLs in output)
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { QuotaLedger } from './_shared/quota/ledger.js';
import { extractQuotaFromDom, parseResetTextToAbsolute } from './_shared/quota/checker.js';
import { acquireLockOrThrow } from './_shared/infra/pid-lock.js';

cli({
    site: 'zlibrary-app',
    name: 'quota-status',
    access: 'read',
    description: 'Show daily download quota from the persistent ledger and the Desktop app\'s live DOM state',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    columns: ['field', 'value'],
    func: async (page) => {
        const lock = await acquireLockOrThrow('zlibrary-app quota-status');
        try {
            // Extract live DOM quota data (navigates to /users/downloads)
            const domData = await extractQuotaFromDom(page);

            // Load existing ledger or bootstrap from DOM data
            const ledger = new QuotaLedger();
            const existing = ledger.load();

            if (!existing && domData.dailyLimit != null) {
                ledger.bootstrap(
                    domData.dailyLimit,
                    parseResetTextToAbsolute(domData.resetText || ''),
                );
                if (domData.dailyUsed != null) {
                    ledger.setDomUsed(domData.dailyUsed);
                }
                ledger.save();
            } else if (domData.dailyUsed != null) {
                ledger.setDomUsed(domData.dailyUsed);
            }

            const stats = ledger.getStats();
            const rows = [];

            // -- DOM quota section --
            rows.push({ field: 'DOM Daily Used', value: domData.dailyUsed != null ? String(domData.dailyUsed) : '(unknown)' });
            rows.push({ field: 'DOM Daily Limit', value: domData.dailyLimit != null ? String(domData.dailyLimit) : '(unknown)' });
            rows.push({ field: 'DOM Daily Remaining', value: domData.dailyRemaining != null ? String(domData.dailyRemaining) : '(unknown)' });
            if (domData.resetText) {
                rows.push({ field: 'DOM Reset In', value: domData.resetText });
            }
            if (domData.progressAriaNow !== null && !Number.isNaN(domData.progressAriaNow)) {
                rows.push({ field: 'DOM Usage (%)', value: domData.progressAriaNow + '%' });
            }

            // -- Separator --
            rows.push({ field: '---', value: '---' });

            // -- Ledger quota section --
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
