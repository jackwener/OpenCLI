/**
 * Z-Library Desktop download-history command.
 *
 * Reads the Download History page (/users/downloads) from the
 * Z-Library Desktop app's renderer via CDP. The page is a standard
 * HTML table (<tr class="dstats-row">) — not the z-bookcard grid.
 *
 * Available fields: rank, title, url, date (DD.MM.YYYY HH:MM).
 * No status, filename, or size columns exist in this DOM.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors'
import { evaluateJson } from '../_shared/browser-utils.js';
import { requireNonEmptyRows, runBrowserStep } from '../_shared/search-adapter.js';

cli({
    site: 'zlibrary-app',
    name: 'download-history',
    access: 'read',
    description: 'List your Z-Library download history',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        {
            name: 'limit',
            type: 'int',
            default: 20,
            help: 'Max results (1–50)',
        },
        {
            name: 'page',
            type: 'int',
            default: 1,
            help: 'Page number for download history',
        },
    ],
    columns: ['rank', 'title', 'url', 'date'],
    func: async (page, kwargs) => {
        return runBrowserStep('zlibrary-app download-history', async () => {
            // Validate --limit (1–50) and --page (1+) — throw ArgumentError instead of silent clamp
            const rawLimit = kwargs.limit != null ? Number(kwargs.limit) : 20;
            if (!Number.isFinite(rawLimit) || !Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 50) {
                throw new ArgumentError(
                    'zlibrary-app download-history --limit must be an integer between 1 and 50',
                    'Got: ' + rawLimit
                )
            }
            const limit = rawLimit;

            const rawPage = kwargs.page != null ? Number(kwargs.page) : 1;
            if (!Number.isFinite(rawPage) || !Number.isInteger(rawPage) || rawPage < 1) {
                throw new ArgumentError(
                    'zlibrary-app download-history --page must be a positive integer',
                    'Got: ' + rawPage
                )
            }
            const pageNum = rawPage;

            // Navigate to the download history page (absolute URL required by CDP)
            const origin = String(await page.evaluate('window.location.origin') || '');
            const pageUrl = new URL('/users/downloads' +
                (pageNum > 1 ? '?page=' + pageNum : ''), origin).href;
            await page.goto(pageUrl, {
                waitUntil: 'load',
                settleMs: 3000,
            });

            // Extract download history rows from the table
            const rows = await evaluateJson(page, `
                var rows = [];
                var trs = document.querySelectorAll('tr.dstats-row');
                var maxResults = ${JSON.stringify(limit)};
                for (var i = 0; i < trs.length && i < maxResults; i++) {
                    var tr = trs[i];
                    var cells = tr.querySelectorAll('td');
                    if (cells.length < 3) continue;

                    var rank = (cells[0]?.textContent || '').trim();

                    // Date: span.hidden-xs has DD.MM.YYYY, p has HH:MM
                    var dateSpan = cells[1]?.querySelector('span.hidden-xs');
                    var timeP = cells[1]?.querySelector('p');
                    var dateParts = [];
                    if (dateSpan) dateParts.push(dateSpan.textContent.trim());
                    if (timeP) dateParts.push(timeP.textContent.trim());
                    var date = dateParts.filter(Boolean).join(' ');

                    // Title + URL: div.book-title > a
                    var link = cells[2]?.querySelector('div.book-title a');
                    var title = link ? (link.textContent || '').trim() : '';
                    var url = '';
                    if (link && link.href) {
                        try {
                            var parsed = new URL(link.href, window.location.origin);
                            if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
                                if (parsed.origin === window.location.origin) {
                                    url = parsed.href;
                                }
                            }
                        } catch (e) {}
                    }
                    if (!title) continue;
                    if (!url) continue;

                    rows.push({ rank: rank, title: title, url: url, date: date });
                }
                return rows;
            `, []);

            return requireNonEmptyRows(
                rows,
                'zlibrary-app download-history',
                'No download history found.',
            );
        });
    },
});
