import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { positiveInteger } from './utils.js';

const CHAT_URL = 'https://lpt.liepin.com/chat/im';

async function openResumeFilter(page) {
    await page.goto(CHAT_URL, { settleMs: 3500 });
    await page.evaluate(() => {
        const filter = [...document.querySelectorAll('.ant-im-segmented-item-label')]
            .find((node) => node.textContent?.trim() === '有简历');
        filter?.click();
    });
    await new Promise((resolve) => setTimeout(resolve, 1800));
}

cli({
    site: 'liepin',
    name: 'chat-resumes',
    access: 'read',
    description: '读取猎聘沟通中候选人主动发送的简历',
    domain: 'lpt.liepin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    defaultWindowMode: 'background',
    siteSession: 'persistent',
    args: [
        { name: 'limit', type: 'int', default: 10, help: '最多读取的简历数（1-20）' },
    ],
    columns: ['name', 'resume_text'],
    func: async (page, args) => {
        const limit = positiveInteger(args.limit, 'limit', 10, 20);
        await openResumeFilter(page);
        const names = await page.evaluate(() => [...document.querySelectorAll('.im-ui-contact-title-main')]
            .filter((node) => node.getClientRects().length > 0)
            .map((node) => node.textContent?.trim())
            .filter(Boolean));
        const selected = [...new Set(names)].slice(0, limit);
        if (selected.length === 0) {
            throw new EmptyResultError('liepin chat-resumes', '有简历筛选中没有候选人');
        }

        const rows = [];
        for (const name of selected) {
            await openResumeFilter(page);
            await page.evaluate((candidateName) => {
                const title = [...document.querySelectorAll('.im-ui-contact-title-main')]
                    .find((node) => node.textContent?.trim() === candidateName);
                title?.closest('.im-ui-contact-item')?.click();
            }, name);
            await new Promise((resolve) => setTimeout(resolve, 1500));
            await page.evaluate(() => {
                const action = [...document.querySelectorAll('*')]
                    .find((node) => node.children.length === 0 && node.textContent?.trim() === '查看简历');
                action?.click();
            });
            await new Promise((resolve) => setTimeout(resolve, 2000));
            const resumeText = await page.evaluate((candidateName) => {
                const text = document.body.innerText;
                const marker = `查看大图\n${candidateName}`;
                const start = text.lastIndexOf(marker);
                return (start >= 0 ? text.slice(start + '查看大图\n'.length) : text).trim();
            }, name);
            rows.push({ name, resume_text: resumeText });
        }
        return rows;
    },
});
