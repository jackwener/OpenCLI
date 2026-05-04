/**
 * BOSS直聘 stats — job statistics overview.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { requirePage, navigateToChat, bossFetch, fetchFriendList, verbose } from './utils.js';
cli({
    site: 'boss',
    name: 'stats',
    access: 'read',
    description: 'BOSS直聘职位数据统计',
    domain: 'www.zhipin.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    browser: true,
    args: [
        { name: 'job-id', default: '', help: 'Encrypted job ID (show all if empty)' },
    ],
    columns: ['job_name', 'salary', 'city', 'status', 'total_chats', 'encrypt_job_id'],
    func: async (page, kwargs) => {
        requirePage(page);
        verbose('Fetching job statistics...');
        const filterJobId = kwargs['job-id'] || '';
        await navigateToChat(page);
        // Get job list
        const jobData = await bossFetch(page, 'https://www.zhipin.com/wapi/zpjob/job/chatted/jobList');
        // Get total chat stats (non-critical, allow failure)
        const chatStats = await bossFetch(page, 'https://www.zhipin.com/wapi/zpchat/chatHelper/statistics', {
            allowNonZero: true,
        });
        const totalFriends = chatStats.zpData?.totalFriendCount || 0;
        // Get per-job chat counts from friend list (non-critical)
        let friendList = [];
        try {
            friendList = await fetchFriendList(page);
        }
        catch { /* ignore */ }
        const jobChatCounts = {};
        for (const f of friendList) {
            const jobName = f.jobName || 'unknown';
            jobChatCounts[jobName] = (jobChatCounts[jobName] || 0) + 1;
        }
        let jobs = jobData.zpData || [];
        if (filterJobId) {
            jobs = jobs.filter((j) => j.encryptJobId === filterJobId);
        }
        const results = jobs.map((j) => ({
            job_name: j.jobName || '',
            salary: j.salaryDesc || '',
            city: j.address || '',
            status: j.jobOnlineStatus === 1 ? '在线' : '已关闭',
            total_chats: String(jobChatCounts[j.jobName] || 0),
            encrypt_job_id: j.encryptJobId || '',
        }));
        if (!filterJobId && results.length > 0) {
            results.push({
                job_name: '--- 总计 ---',
                salary: '',
                city: '',
                status: `${jobs.length} 个职位`,
                total_chats: String(totalFriends),
                encrypt_job_id: '',
            });
        }
        return results;
    },
});
