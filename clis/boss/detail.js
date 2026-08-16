/**
 * BOSS直聘 job detail — extract the fully rendered job page. Read-only.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { requirePage, navigateTo, verbose } from './utils.js';

function cleanText(value) {
    return String(value || '')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function domSnapshotToRow(raw, jobId) {
    if (!raw || typeof raw !== 'object' || !cleanText(raw.name)) return null;
    const unique = values => [...new Set(values.map(cleanText).filter(Boolean))];
    return {
        name: cleanText(raw.name),
        salary: cleanText(raw.salary),
        experience: cleanText(raw.experience),
        degree: cleanText(raw.degree),
        city: cleanText(raw.city),
        district: cleanText(raw.district),
        description: cleanText(raw.description),
        skills: unique(Array.isArray(raw.skills) ? raw.skills : []).join(', '),
        welfare: unique(Array.isArray(raw.welfare) ? raw.welfare : []).join(', '),
        boss_name: cleanText(raw.boss_name),
        boss_title: cleanText(raw.boss_title),
        active_time: cleanText(raw.active_time),
        company: cleanText(raw.company),
        industry: cleanText(raw.industry),
        scale: cleanText(raw.scale),
        stage: cleanText(raw.stage),
        address: cleanText(raw.address),
        url: `https://www.zhipin.com/job_detail/${jobId}.html`,
    };
}

async function readRenderedPage(page, jobId) {
    const raw = await page.evaluate(() => {
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
                .filter(node => node.nodeType === Node.TEXT_NODE)
                .map(node => node.textContent.trim()).filter(Boolean).join(' ')
            : '';
        const bossLines = bossBlock
            ? (bossBlock.innerText || '').split(/\n|·/).map(value => value.trim()).filter(Boolean)
            : [];
        const activeTime = bossHeading ? text('span', bossHeading) : bossLines.find(value => /活跃|在线/.test(value)) || '';
        const resolvedBossName = bossName || bossLines[0] || '';
        const bossTitle = bossLines.findLast(value => value !== resolvedBossName && value !== activeTime && value !== company) || '';
        const addressBlock = document.querySelector('.company-address');
        const address = addressBlock
            ? (addressBlock.innerText || '').split('\n').map(value => value.trim())
                .filter(value => value && value !== '工作地址' && value !== '点击查看地图')[0] || ''
            : '';
        return {
            name: title,
            salary: first(['.job-primary .salary', '.job-banner .salary', '.job-primary .name + span']),
            city: limits[0] || '',
            experience: limits[1] || '',
            degree: limits[2] || '',
            description: first(['.job-detail .job-detail-section .job-sec-text:not(.fold-text)', '.job-detail .job-sec-text:not(.fold-text)', '.job-sec-text:not(.fold-text)']),
            skills: texts('.job-detail .job-keyword-list li, .job-keyword-list li'),
            welfare: texts('.job-banner .job-tags span, .job-primary .job-tags span'),
            boss_name: resolvedBossName,
            boss_title: bossTitle,
            active_time: activeTime,
            company,
            industry: sideFacts.find(value => !/人|融资|上市|轮/.test(value)) || '',
            scale: sideFacts.find(value => /\d+.*人/.test(value)) || '',
            stage: sideFacts.find(value => /融资|上市|不需要融资/.test(value)) || '',
            address,
        };
    });
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
    throw new CommandExecutionError('BOSS detail page did not expose a complete job posting');
}
cli({
    site: 'boss',
    name: 'detail',
    access: 'read',
    description: 'BOSS直聘查看职位详情',
    domain: 'www.zhipin.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    browser: true,
    defaultWindowMode: 'background',
    siteSession: 'persistent',
    args: [
        { name: 'security-id', positional: true, required: true, help: 'Security ID from search results (security_id field)' },
    ],
    columns: [
        'name', 'salary', 'experience', 'degree', 'city', 'district',
        'description', 'skills', 'welfare',
        'boss_name', 'boss_title', 'active_time',
        'company', 'industry', 'scale', 'stage',
        'address', 'url',
    ],
    func: async (page, kwargs) => {
        requirePage(page);
        const jobId = String(kwargs['security-id'] || '').trim();
        verbose('Fetching job detail from the rendered BOSS page...');
        return [await captureJobDetail(page, jobId)];
    },
});

export const __test__ = { cleanText, domSnapshotToRow };
