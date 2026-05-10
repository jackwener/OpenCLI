import { cli, Strategy } from '@jackwener/opencli/registry';
import { requirePage, navigateToChat, fetchFriendList } from './utils.js';
cli({
    site: 'boss',
    name: 'chatlist',
    access: 'read',
    description: 'BOSS直聘查看聊天列表（招聘端）',
    domain: 'www.zhipin.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    browser: true,
    args: [
        { name: 'page', type: 'int', default: 1, help: 'Page number' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of results' },
        { name: 'job-id', default: '0', help: 'Filter by job ID (0=all)' },
    ],
    columns: ['name', 'job', 'last_msg', 'last_time', 'uid', 'security_id'],
    func: async (page, kwargs) => {
        requirePage(page);
        await navigateToChat(page);
        const friends = await fetchFriendList(page, {
            pageNum: kwargs.page || 1,
            jobId: kwargs['job-id'] || '0',
        });
        return friends.slice(0, kwargs.limit || 20).map((f) => ({
            name: f.name || '',
            job: f.jobName || '',
            last_msg: f.lastMessageInfo?.text || '',
            last_time: f.lastTime || '',
            uid: f.encryptUid || '',
            security_id: f.securityId || '',
        }));
    },
});
