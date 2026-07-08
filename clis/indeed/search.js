/**
 * Indeed keyword search.
 *
 * Drives the public `/jobs?q=&l=` listing page through a real browser
 * because Cloudflare returns 403 to bare fetches. Extraction happens
 * inside `page.evaluate` against the rendered DOM (Indeed's JSON-island
 * is heavily obfuscated and changes shape per A/B bucket).
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError, CommandExecutionError } from '@jackwener/opencli/errors';
import {
    SEARCH_COLUMNS,
    requireQuery,
    requireBoundedInt,
    requireNonNegativeInt,
    requireFromage,
    requireSort,
    buildSearchUrl,
    searchCardToRow,
} from './utils.js';

cli({
    site: 'indeed',
    name: 'search',
    access: 'read',
    description: 'Indeed keyword job search (rendered DOM via browser session, US site)',
    domain: 'www.indeed.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Job keyword (title / skill / company)' },
        { name: 'location', type: 'string', default: '', help: 'Location filter (e.g. "remote", "New York, NY", "San Francisco")' },
        { name: 'fromage', type: 'string', default: '', help: 'Recency filter, days back: 1 / 3 / 7 / 14' },
        { name: 'sort', type: 'string', default: 'relevance', help: 'Sort order: relevance | date' },
        { name: 'start', type: 'int', default: 0, help: 'Pagination offset (multiple of 10, 0-based)' },
        { name: 'limit', type: 'int', default: 15, help: 'Max rows to return (1-25, capped at one page)' },
    ],
    columns: SEARCH_COLUMNS,
    func: async (page, kwargs) => {
        const query = requireQuery(kwargs.query);
        const location = String(kwargs.location ?? '').trim();
        const fromage = requireFromage(kwargs.fromage);
        const sort = requireSort(kwargs.sort);
        const start = requireNonNegativeInt(kwargs.start, 0, 'start');
        const limit = requireBoundedInt(kwargs.limit, 15, 25, 'limit');

        const url = buildSearchUrl({ query, location, fromage, sort, start });
        await page.goto(url);
        await page.wait(4);

        let cards;
        try {
            cards = await page.evaluate(`(async () => {
                const hasResults = () => !!document.querySelector('.job_seen_beacon');
                const hasEmptyState = () => {
                    const text = document.body?.innerText || '';
                    return !!document.querySelector('[data-testid="searchCountPages"], [data-testid="searchCount"], [data-testid="noResultsMessage"], [data-testid="empty-serp-result"]')
                        || /did not match any jobs|no jobs found|0 jobs/i.test(text);
                };
                let ready = hasResults() || hasEmptyState();
                for (let i = 0; i < 30; i++) {
                    if (ready) break;
                    await new Promise(r => setTimeout(r, 500));
                    ready = hasResults() || hasEmptyState();
                }
                const blocks = document.querySelectorAll('.job_seen_beacon');
                const seen = new Set();
                const out = [];
                for (const b of blocks) {
                    const titleA = b.querySelector('h2.jobTitle a, [class*="jcs-JobTitle"]');
                    const jk = titleA?.getAttribute('data-jk');
                    if (!jk || seen.has(jk)) continue;
                    seen.add(jk);
                    const tags = Array.from(b.querySelectorAll('.metadataContainer li span'))
                        .map(s => (s.textContent || '').trim())
                        .filter(Boolean);
                    out.push({
                        jk,
                        title: b.querySelector('h2.jobTitle span')?.textContent?.trim() ?? '',
                        company: b.querySelector('[data-testid="company-name"]')?.textContent?.trim() ?? '',
                        location: b.querySelector('[data-testid="text-location"]')?.textContent?.trim() ?? '',
                        salary: b.querySelector('.salary-snippet-container span')?.textContent?.trim() ?? '',
                        tags,
                    });
                }
                const blockedHeadline = document.title || '';
                const challenge = blockedHeadline.includes('Just a moment') || !!document.querySelector('[id^="cf-"]');
                return { cards: out, challenge, ready };
            })()`);
        }
        catch (e) {
            throw new CommandExecutionError(`Failed to scrape Indeed search DOM: ${e?.message ?? e}`, 'The page may not have fully loaded; try again.');
        }

        if (cards?.challenge) {
            throw new CommandExecutionError('Indeed served a Cloudflare challenge page', 'Open https://www.indeed.com in the connected browser and clear the challenge, then retry.');
        }
        if (!cards?.ready) {
            throw new CommandExecutionError('Indeed search page did not expose result or empty-state markers within 15s', 'Indeed may still be loading or the DOM shape may have changed; retry after opening Indeed in the connected browser.');
        }

        const list = Array.isArray(cards?.cards) ? cards.cards : [];
        if (list.length === 0) {
            throw new EmptyResultError('indeed search', `No Indeed jobs matched "${query}"${location ? ` in ${location}` : ''}`);
        }
        return list.slice(0, limit).map((c, i) => searchCardToRow(c, start + i + 1));
    },
});
