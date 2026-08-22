/**
 * BOSS直聘 job detail — extract the fully rendered job page. Read-only.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { readRequiredString, requirePage, navigateTo, verbose } from './utils.js';

const BOSS_DOMAIN = 'www.zhipin.com';

function cleanText(value) {
    return String(value || '')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function domSnapshotToRow(raw, jobId) {
    if (!raw || typeof raw !== 'object' || !cleanText(raw.jobName)) return null;
    const unique = values => [...new Set(values.map(cleanText).filter(Boolean))];
    const nullable = value => cleanText(value) || null;
    return {
        name: cleanText(raw.jobName),
        salary: cleanText(raw.salaryText),
        experience: cleanText(raw.experienceText),
        degree: cleanText(raw.degreeText),
        city: nullable(raw.cityText),
        address: nullable(raw.addressText),
        description: cleanText(raw.descriptionText),
        skills: unique(Array.isArray(raw.skillTexts) ? raw.skillTexts : []).join(', '),
        welfare: unique(Array.isArray(raw.welfareTexts) ? raw.welfareTexts : []).join(', '),
        boss_name: nullable(raw.recruiterName),
        boss_title: nullable(raw.recruiterTitle),
        active_time: nullable(raw.recruiterActiveTime),
        company: cleanText(raw.companyName),
        industry: nullable(raw.industryText),
        scale: nullable(raw.scaleText),
        stage: nullable(raw.stageText),
        url: `https://www.zhipin.com/job_detail/${jobId}.html`,
    };
}

export function extractRenderedJob() {
    const text = (selector, root = document) => {
        const element = root.querySelector(selector);
        return element ? (element.innerText || element.textContent || '').trim() : '';
    };
    const texts = (selector, root = document) => Array.from(root.querySelectorAll(selector))
        .map(element => (element.innerText || element.textContent || '').trim())
        .filter(Boolean);
    const first = selectors => {
        for (const selector of selectors) {
            const value = text(selector);
            if (value) return value;
        }
        return '';
    };
    const title = first(['.job-primary .name h1', '.job-primary h1', 'h1[title]']);
    const limits = texts('.job-primary .job-limit a, .job-primary .job-limit span, .job-primary p a, .job-primary p span');
    const companyCandidates = Array.from(document.querySelectorAll('.job-sider a[href^="/gongsi/"], .detail-op a[href*="/gongsi/"]'))
        .map(element => (element.getAttribute('title') || element.innerText || element.textContent || '').trim())
        .filter(value => value && !/查看.*职位/.test(value));
    const companyFromTitle = document.title.match(/_([^_]+)招聘-BOSS直聘$/)?.[1] || '';
    const company = companyCandidates[0] || companyFromTitle;
    const sideFacts = texts('.job-sider p, .job-sider a[href^="/i"]')
        .filter(value => value !== '公司基本信息' && value !== '查看全部职位');
    const bossBlock = document.querySelector('.job-boss-info');
    const bossHeading = bossBlock?.querySelector('h2');
    const bossName = bossHeading
        ? Array.from(bossHeading.childNodes)
            .filter(node => node.nodeType === 3)
            .map(node => node.textContent.trim()).filter(Boolean).join(' ')
        : '';
    const bossLines = bossBlock
        ? (bossBlock.innerText || bossBlock.textContent || '').split(/\n|·/).map(value => value.trim()).filter(Boolean)
        : [];
    const activeTime = bossHeading ? text('span', bossHeading) : bossLines.find(value => /活跃|在线/.test(value)) || '';
    const resolvedBossName = bossName || bossLines[0] || '';
    const bossAttributes = text('.boss-info-attr', bossBlock).split('·').map(value => value.trim()).filter(Boolean);
    const bossTitle = bossAttributes.findLast(value => value !== company) ||
        bossLines.findLast(value => value !== resolvedBossName && value !== activeTime && value !== company) || '';
    const addressBlock = document.querySelector('.company-address');
    const address = text('.location-address', addressBlock) || (addressBlock
        ? (addressBlock.innerText || addressBlock.textContent || '').split('\n').map(value => value.trim())
            .filter(value => value && value !== '工作地址' && value !== '点击查看地图')[0] || ''
        : '');
    return {
        jobName: title,
        salaryText: first(['.job-primary .salary', '.job-banner .salary', '.job-primary .name + span']),
        // Prefer BOSS's semantic classes; fall back to positional order only if
        // they are absent. Positional indexing alone shifts every field when the
        // header gains or loses a node.
        cityText: text('.job-primary .text-city') || limits[0] || '',
        experienceText: text('.job-primary .text-experiece') || limits[1] || '',
        degreeText: text('.job-primary .text-degree') || limits[2] || '',
        descriptionText: first(['.job-detail .job-detail-section .job-sec-text:not(.fold-text)', '.job-detail .job-sec-text:not(.fold-text)', '.job-sec-text:not(.fold-text)']),
        skillTexts: texts('.job-detail .job-keyword-list li, .job-keyword-list li'),
        welfareTexts: texts('.job-banner .job-tags span, .job-primary .job-tags span'),
        recruiterName: resolvedBossName,
        recruiterTitle: bossTitle,
        recruiterActiveTime: activeTime,
        companyName: company,
        industryText: sideFacts.find(value => !/人|融资|上市|轮/.test(value)) || '',
        scaleText: sideFacts.find(value => /\d+.*人/.test(value)) || '',
        // `D轮及以上` / `天使轮` are the common shapes; the industry filter above
        // already excludes 轮, so omitting it here left stage permanently empty.
        stageText: sideFacts.find(value => /轮|融资|上市/.test(value)) || '',
        addressText: address,
    };
}

async function readRenderedPage(page, jobId) {
    const raw = await page.evaluate(extractRenderedJob);
    return domSnapshotToRow(raw, jobId);
}

async function captureJobDetail(page, jobId) {
    const url = `https://www.zhipin.com/job_detail/${encodeURIComponent(jobId)}.html`;
    await navigateTo(page, 'https://www.zhipin.com/web/geek/jobs', 2);
    for (let navigationAttempt = 0; navigationAttempt < 2; navigationAttempt++) {
        await navigateTo(page, url, 5);
        for (let attempt = 0; attempt < 5; attempt++) {
            try {
                const domRow = await readRenderedPage(page, jobId);
                if (domRow?.name && domRow?.description && domRow?.company) return domRow;
            } catch { /* wait for a complete render */ }
            if (attempt < 4) await page.wait(1);
        }
    }
    // The retry loop above swallows every read error, so without this check a
    // session that got bounced to the login wall reports "incomplete posting".
    // The API path this command replaced classified that as AuthRequiredError
    // via assertOk; keep that signal rather than losing it to the UI rewrite.
    if (await isLoginWall(page)) {
        throw new AuthRequiredError(BOSS_DOMAIN, 'BOSS redirected the job detail page to the login flow');
    }
    throw new CommandExecutionError('BOSS detail page did not expose a complete job posting');
}

async function isLoginWall(page) {
    try {
        return await page.evaluate(`
            (() => {
                const href = window.location.href || '';
                if (/\\/login|\\/user\\/login|passport/.test(href)) return true;
                return !!document.querySelector('.sign-form, .login-card, [class*="login-register"]');
            })()
        `) === true;
    } catch {
        return false;
    }
}
cli({
    site: 'boss',
    name: 'detail',
    access: 'read',
    description: 'BOSS直聘查看职位详情',
    domain: 'www.zhipin.com',
    strategy: Strategy.UI,
    navigateBefore: false,
    browser: true,
    defaultWindowMode: 'background',
    siteSession: 'persistent',
    args: [
        { name: 'security-id', positional: true, required: true, help: 'Security ID from search results (security_id field)' },
    ],
    columns: [
        'name', 'salary', 'experience', 'degree',
        'city', 'address',
        'description', 'skills', 'welfare',
        'boss_name', 'boss_title', 'active_time',
        'company', 'industry', 'scale', 'stage', 'url',
    ],
    func: async (page, kwargs) => {
        requirePage(page);
        const jobId = readRequiredString(kwargs['security-id'], 'security-id');
        if (!/^[A-Za-z0-9_-]+$/.test(jobId)) {
            throw new ArgumentError('boss security-id contains unsupported characters', 'Pass the security_id returned by `opencli boss search`');
        }
        verbose('Fetching job detail from the rendered BOSS page...');
        return [await captureJobDetail(page, jobId)];
    },
});

export const __test__ = { cleanText, domSnapshotToRow };
