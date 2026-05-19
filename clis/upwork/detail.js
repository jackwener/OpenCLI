/**
 * Upwork job detail.
 *
 * Reads the full job posting (title, description, budget, experience
 * level, workload, client stats, applicant count) for a given
 * ciphertext id (the `~02…` form surfaced by `upwork search` /
 * `upwork feed`). Unlike search/feed, the job-detail page does not
 * populate `window.__NUXT__.state` for the job — it rehydrates into
 * the Vuex store at `window.$nuxt.$store.state.jobDetails.{job, buyer,
 * applicants, …}`. We read straight from that store.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    CommandExecutionError,
    EmptyResultError,
    AuthRequiredError,
} from '@jackwener/opencli/errors';
import {
    DETAIL_COLUMNS,
    buildJobUrl,
    decodeExperienceLevel,
    decodeWorkload,
    formatBudgetFromDetail,
    formatSkills,
    isPlainObject,
    jobType,
    requireCiphertext,
    stripHighlight,
    unwrapBrowserResult,
} from './utils.js';

cli({
    site: 'upwork',
    name: 'detail',
    aliases: ['job', 'view'],
    access: 'read',
    description: 'Read the full Upwork job posting by ciphertext id (e.g. ~022054964136512093518)',
    domain: 'www.upwork.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'Job ciphertext id (~01… / ~02…) or full /jobs/~02… URL' },
    ],
    columns: DETAIL_COLUMNS,
    func: async (page, kwargs) => {
        const id = requireCiphertext(kwargs.id);
        const url = buildJobUrl(id);
        await page.goto(url);
        await page.wait(5);

        let payload;
        try {
            payload = unwrapBrowserResult(await page.evaluate(`(async () => {
                const haveStore = () => !!(window.$nuxt && window.$nuxt.$store && window.$nuxt.$store.state && window.$nuxt.$store.state.jobDetails && window.$nuxt.$store.state.jobDetails.job);
                let ready = haveStore();
                for (let i = 0; i < 30; i++) {
                    if (ready) break;
                    await new Promise(r => setTimeout(r, 500));
                    ready = haveStore();
                }
                const onLogin = /\\/(ab\\/account-security\\/login|nx\\/login)/.test(location.pathname);
                const challenge = (document.title || '').toLowerCase().includes('just a moment') || !!document.querySelector('[id^="cf-"]');
                if (!ready) {
                    return { ready, onLogin, challenge, job: null, buyer: null };
                }
                const s = window.$nuxt.$store.state.jobDetails;
                return {
                    ready,
                    onLogin,
                    challenge,
                    job: s.job ? JSON.parse(JSON.stringify(s.job)) : null,
                    buyer: s.buyer ? JSON.parse(JSON.stringify(s.buyer)) : null,
                };
            })()`));
        }
        catch (e) {
            throw new CommandExecutionError(`Failed to read Upwork job-detail store: ${e?.message ?? e}`, 'The Vuex store was not reachable; try again after opening Upwork in the connected browser.');
        }

        if (payload?.onLogin) {
            throw new AuthRequiredError('upwork.com', 'Upwork redirected to login. Open https://www.upwork.com in the connected browser and sign in, then retry.');
        }
        if (payload?.challenge) {
            throw new CommandExecutionError('Upwork served a Cloudflare challenge page', 'Open https://www.upwork.com in the connected browser and clear the challenge, then retry.');
        }
        if (!isPlainObject(payload)) {
            throw new CommandExecutionError('Upwork detail returned an unexpected Browser Bridge payload shape');
        }
        if (!payload?.ready || !payload.job) {
            throw new EmptyResultError('upwork detail', `No Upwork job posting found for id "${id}" (may be closed, expired, or private)`);
        }
        if (!isPlainObject(payload.job)) {
            throw new CommandExecutionError('Upwork job-detail store had an unexpected job shape; expected an object.');
        }

        const job = payload.job;
        const returnedCiphertext = String(job?.ciphertext ?? '').trim();
        if (returnedCiphertext && returnedCiphertext !== id) {
            throw new CommandExecutionError(`Upwork job-detail store returned ciphertext "${returnedCiphertext}" while reading "${id}".`);
        }
        const buyer = payload.buyer || {};
        const stats = buyer?.stats || {};
        const location = buyer?.location || {};
        const category = job?.category?.name || '';
        const skills = formatSkills(job);
        const totalSpent = Number(stats?.totalCharges?.amount);
        const totalHires = Number(stats?.totalJobsWithHires);
        const score = Number(stats?.score);
        const totalApplicants = Number(job?.clientActivity?.totalApplicants);

        return [{
            id,
            title: stripHighlight(job?.title),
            type: jobType(job?.type),
            budget: formatBudgetFromDetail(job),
            experienceLevel: decodeExperienceLevel(job?.contractorTier),
            workload: decodeWorkload(job?.workload),
            category,
            skills,
            description: String(job?.description ?? '').trim(),
            clientCountry: location?.country || '',
            clientSpent: Number.isFinite(totalSpent) && totalSpent > 0 ? totalSpent : null,
            clientHires: Number.isFinite(totalHires) ? totalHires : null,
            clientRating: Number.isFinite(score) && score > 0 ? score : null,
            proposalsCount: Number.isFinite(totalApplicants) ? totalApplicants : null,
            publishedOn: job?.publishTime || job?.postedOn || job?.createdOn || '',
            url,
        }];
    },
});
