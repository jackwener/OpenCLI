import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { positiveInteger, valueFrom } from './utils.js';

const CHAT_URL = 'https://lpt.liepin.com/chat/im';

function mapChat(item) {
    const contact = item?.contact ?? item?.userInfo ?? item?.oppositeUser ?? {};
    const latest = item?.lastMessage ?? item?.latestMessage ?? item?.message ?? {};
    return {
        opposite_im_id: valueFrom([item, contact], ['oppositeImId', 'imId', 'usercImId']),
        resume_id: valueFrom([item, contact], ['resIdEncode', 'resumeId', 'encryptResumeId']),
        name: valueFrom([item, contact], ['showName', 'name', 'userName', 'oppositeUserName']),
        job_title: valueFrom([item, contact], ['jobTitle', 'ejobTitle', 'currentJobTitle']),
        latest_message: valueFrom([latest, item], ['content', 'text', 'messageContent', 'lastMessage']),
        latest_at: valueFrom([latest, item], ['sendTime', 'createTime', 'updateTime', 'latestTime']),
        unread_count: valueFrom([item], ['unreadCount', 'unReadCount', 'unreadNum']),
    };
}

cli({
    site: 'liepin',
    name: 'chats',
    access: 'read',
    description: '列出猎聘企业版最近沟通的人才',
    domain: 'lpt.liepin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    defaultWindowMode: 'background',
    siteSession: 'persistent',
    args: [
        { name: 'page', type: 'int', default: 1, help: '页码（从 1 开始）' },
        { name: 'limit', type: 'int', default: 20, help: '返回数量（1-50）' },
        { name: 'hasResume', type: 'boolean', default: false, help: '只列出已发送简历的会话' },
    ],
    columns: ['opposite_im_id', 'resume_id', 'name', 'job_title', 'latest_message', 'latest_at', 'unread_count'],
    func: async (page, args) => {
        const pageNumber = positiveInteger(args.page, 'page', 1);
        const limit = positiveInteger(args.limit, 'limit', 20, 50);
        await page.goto(CHAT_URL, { settleMs: 3500 });
        if (args.hasResume === true) {
            await page.evaluate(() => {
                const filter = [...document.querySelectorAll('.ant-im-segmented-item-label')]
                    .find((node) => node.textContent?.trim() === '有简历');
                filter?.click();
            });
            await new Promise((resolve) => setTimeout(resolve, 1800));
        }
        const allRows = await page.evaluate(() => [...document.querySelectorAll('.im-ui-contact-item')]
            .filter((item) => item.getClientRects().length > 0)
            .map((item) => ({
                opposite_im_id: item.getAttribute('data-im-id'),
                resume_id: item.getAttribute('data-resume-id'),
                name: item.querySelector('.im-ui-contact-title-main')?.textContent?.trim() || null,
                job_title: item.querySelector('.im-ui-contact-title-sub')?.textContent?.trim() || null,
                latest_message: item.querySelector('.im-ui-last-message')?.textContent?.trim() || null,
                latest_at: item.querySelector('.contact-time')?.textContent?.trim() || null,
                unread_count: item.querySelector('.ant-im-badge-count')?.textContent?.trim() || null,
            }))
            .filter((row) => row.name));
        const start = (pageNumber - 1) * limit;
        const rows = allRows.slice(start, start + limit);
        if (rows.length === 0) throw new EmptyResultError('liepin chats', '当前没有沟通记录');
        return rows;
    },
});

export const __test__ = { mapChat };
