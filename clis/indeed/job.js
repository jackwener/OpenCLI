/**
 * Indeed job detail.
 *
 * Reads the full job posting (title, company, location, salary, job type,
 * description) for a given `jk` (job key, the 16-char id surfaced by
 * `indeed search`). Browser-driven for the same Cloudflare reason as
 * `search`.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError, CommandExecutionError } from '@jackwener/opencli/errors';
import {
    JOB_COLUMNS,
    requireJobKey,
    buildJobUrl,
} from './utils.js';

cli({
    site: 'indeed',
    name: 'job',
    aliases: ['detail', 'view'],
    access: 'read',
    description: 'Read the full Indeed job posting by jk (job key)',
    domain: 'www.indeed.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'Job key (16-char hex from `indeed search`, e.g. "dccc07ac5a6a3683")' },
    ],
    columns: JOB_COLUMNS,
    func: async (page, kwargs) => {
        const jk = requireJobKey(kwargs.id);
        const url = buildJobUrl(jk);
        await page.goto(url);
        await page.wait(4);

        let detail;
        try {
            detail = await page.evaluate(`(async () => {
                let ready = !!document.querySelector('#jobDescriptionText, h1, [data-testid="error-page"]');
                for (let i = 0; i < 30; i++) {
                    if (ready) break;
                    await new Promise(r => setTimeout(r, 500));
                    ready = !!document.querySelector('#jobDescriptionText, h1, [data-testid="error-page"]');
                }
                const challenge = (document.title || '').includes('Just a moment') || !!document.querySelector('[id^="cf-"]');
                const notFound = !!document.querySelector('[data-testid="error-page"]') || /Page Not Found|not found/i.test(document.querySelector('h1')?.textContent || '');
                const title = document.querySelector('h1')?.textContent?.trim() ?? '';
                const company = document.querySelector('[data-testid="inlineHeader-companyName"] a, [data-testid="inlineHeader-companyName"], [data-company-name="true"]')?.textContent?.trim() ?? '';
                const location = document.querySelector('[data-testid="jobsearch-JobInfoHeader-companyLocation"] div, [data-testid="inlineHeader-companyLocation"]')?.textContent?.trim() ?? '';
                const salary = document.querySelector('[id*="salaryInfoAndJobType"] span, [data-testid="job-salary"]')?.textContent?.trim() ?? '';
                const jobType = Array.from(document.querySelectorAll('[id*="salaryInfoAndJobType"] span, [data-testid="job-type"]'))
                    .map(s => (s.textContent || '').trim())
                    .filter(t => t && t !== salary)
                    .join(', ');
                const description = document.querySelector('#jobDescriptionText')?.innerText?.trim() ?? '';
                return { ready, challenge, notFound, title, company, location, salary, jobType, description };
            })()`);
        }
        catch (e) {
            throw new CommandExecutionError(`Failed to scrape Indeed job detail DOM: ${e?.message ?? e}`, 'The page may not have fully loaded; try again.');
        }

        if (detail?.challenge) {
            throw new CommandExecutionError('Indeed served a Cloudflare challenge page', 'Open https://www.indeed.com in the connected browser and clear the challenge, then retry.');
        }
        if (!detail?.ready) {
            throw new CommandExecutionError('Indeed job page did not expose detail or error markers within 15s', 'Indeed may still be loading or the DOM shape may have changed; retry after opening Indeed in the connected browser.');
        }
        if (detail?.notFound || (!detail?.title && !detail?.description)) {
            throw new EmptyResultError('indeed job', `No Indeed job posting found for jk "${jk}"`);
        }

        return [{
            id: jk,
            title: detail.title.replace(/\s+/g, ' ').trim(),
            company: detail.company.replace(/\s+/g, ' ').trim(),
            location: detail.location.replace(/\s+/g, ' ').trim(),
            salary: detail.salary.replace(/\s+/g, ' ').trim(),
            job_type: detail.jobType.replace(/\s+/g, ' ').trim(),
            description: detail.description,
            url,
        }];
    },
});
