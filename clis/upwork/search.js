/**
 * Upwork job search.
 *
 * Drives the public `/nx/search/jobs/?q=` page through a real browser
 * Reads Nuxt search state when available and falls back to rendered job
 * cards when Upwork changes the state shape.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    CommandExecutionError,
    EmptyResultError,
    AuthRequiredError,
} from '@jackwener/opencli/errors';
import {
    buildSearchUrl,
    isPlainObject,
    jobsToListRows,
    LIST_COLUMNS,
    requireBoundedInt,
    requirePositiveInt,
    requireQuery,
    requireSort,
    unwrapBrowserResult,
} from './utils.js';

cli({
    site: 'upwork',
    name: 'search',
    access: 'read',
    description: 'Upwork keyword job search (logged-in browser session, US site)',
    domain: 'www.upwork.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Job keyword (skill / title / company)' },
        { name: 'location', type: 'string', default: '', help: 'Country/city filter (e.g. "United States", "Remote")' },
        { name: 'category', type: 'string', default: '', help: 'Category uid filter (advanced; from job detail `category` slug)' },
        { name: 'sort', type: 'string', default: 'recency', help: 'Sort: recency | relevance | client_total_charge | client_total_reviews' },
        { name: 'page', type: 'int', default: 1, help: 'Page number (1-based)' },
        { name: 'per_page', type: 'int', default: 10, help: 'Rows per page (10-50, capped at one page)' },
    ],
    columns: LIST_COLUMNS,
    func: async (page, kwargs) => {
        const query = requireQuery(kwargs.query);
        const location = String(kwargs.location ?? '').trim();
        const category = String(kwargs.category ?? '').trim();
        const sort = requireSort(kwargs.sort);
        const pageNum = requirePositiveInt(kwargs.page, 1, 'page');
        const perPage = requireBoundedInt(kwargs.per_page, 10, 10, 50, 'per_page');

        const url = buildSearchUrl({ query, location, category, sort, page: pageNum, perPage });
        await page.goto(url);
        await page.wait(4);

        let payload;
        try {
            payload = unwrapBrowserResult(await page.evaluate(`(async () => {
                const haveState = () => !!(window.__NUXT__ && window.__NUXT__.state && window.__NUXT__.state.jobsSearch);
                const cards = () => Array.from(document.querySelectorAll('article')).filter(a => a.querySelector('h2 a[href*="/jobs/"]'));
                let ready = haveState() || cards().length > 0;
                for (let i = 0; i < 30; i++) {
                    if (ready) break;
                    await new Promise(r => setTimeout(r, 500));
                    ready = haveState() || cards().length > 0;
                }
                const onLogin = /\\/(ab\\/account-security\\/login|nx\\/login)/.test(location.pathname);
                const challenge = (document.title || '').toLowerCase().includes('just a moment') || !!document.querySelector('[id^="cf-"]');
                const state = window.__NUXT__ && window.__NUXT__.state && window.__NUXT__.state.jobsSearch;
                return {
                    ready,
                    onLogin,
                    challenge,
                    jobsPresent: !!(state && Object.prototype.hasOwnProperty.call(state, 'jobs')),
                    jobs: state ? state.jobs : undefined,
                    paging: state && state.paging ? state.paging : null,
                    status: state ? state.status : null,
                    cards: state && Array.isArray(state.jobs) ? null : cards().map(a => {
                        const link = a.querySelector('h2 a[href*="/jobs/"]');
                        const id = link?.href.match(/~0[12]\\d{15,21}/)?.[0] || '';
                        const info = a.querySelector('[data-test="JobInfo"]')?.innerText || '';
                        const client = a.querySelector('[data-test="JobInfoClient"]')?.innerText || '';
                        return {
                            id, title: link?.innerText?.trim() || '',
                            type: /Fixed price/i.test(info) ? 'fixed' : /Hourly/i.test(info) ? 'hourly' : '',
                            budget: (info.match(/\\$[\\d,.]+(?:\\s*-\\s*\\$[\\d,.]+)?/) || [])[0] || '',
                            experienceLevel: (info.match(/Entry Level|Intermediate|Expert/i) || [])[0]?.toLowerCase() || '',
                            proposalsTier: (a.querySelector('[data-test="proposals-tier"]')?.innerText || '').replace(/^Proposals:\\s*/i, '').trim(),
                            skills: Array.from(a.querySelectorAll('[data-test="token"]')).map(t => t.innerText.trim()).filter(Boolean).join(', '),
                            clientCountry: (client.match(/(?:Location\\s+)([^\\n]+)/i) || [])[1] || '',
                            clientRating: null,
                            publishedOn: '', // Rendered cards show relative time; detail provides the timestamp.
                            url: id ? 'https://www.upwork.com/jobs/' + id : '',
                        };
                    }),
                };
            })()`));
        }
        catch (e) {
            throw new CommandExecutionError(`Failed to read Upwork search state: ${e?.message ?? e}`, 'The Nuxt state global was not reachable; try again after opening Upwork in the connected browser.');
        }

        if (payload?.onLogin) {
            throw new AuthRequiredError('upwork.com', 'Upwork redirected to login. Open https://www.upwork.com in the connected browser and sign in, then retry.');
        }
        if (payload?.challenge) {
            throw new CommandExecutionError('Upwork served a Cloudflare challenge page', 'Open https://www.upwork.com in the connected browser and clear the challenge, then retry.');
        }
        if (!payload?.ready) {
            throw new CommandExecutionError('Upwork search results were not present within 15s', 'Check the logged-in browser search page and retry.');
        }
        if (!isPlainObject(payload)) {
            throw new CommandExecutionError('Upwork search returned an unexpected Browser Bridge payload shape');
        }
        if (Array.isArray(payload.cards)) {
            const cards = payload.cards.slice(0, perPage);
            if (cards.length === 0) throw new EmptyResultError('upwork search', `No Upwork jobs matched "${query}"`);
            const offset = (pageNum - 1) * perPage;
            return cards.map((card, index) => {
                if (!/^~0[12]\d{15,21}$/.test(card.id)) throw new CommandExecutionError(`Upwork result at rank ${offset + index + 1} has no valid job id.`);
                return { rank: offset + index + 1, ...card };
            });
        }
        if (!payload.jobsPresent || !Array.isArray(payload.jobs)) {
            throw new CommandExecutionError('Upwork search state had an unexpected jobs shape; expected window.__NUXT__.state.jobsSearch.jobs to be an array.');
        }

        const jobs = payload.jobs;
        if (jobs.length === 0) {
            throw new EmptyResultError('upwork search', `No Upwork jobs matched "${query}"${location ? ` in ${location}` : ''}`);
        }

        const offset = (pageNum - 1) * perPage;
        const rows = jobsToListRows(jobs, { offset, limit: perPage });
        if (rows.length === 0) {
            throw new CommandExecutionError('Upwork search results did not include any job with a valid ciphertext id; cannot produce round-trippable detail rows.');
        }
        return rows;
    },
});
