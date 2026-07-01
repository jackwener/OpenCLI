/**
 * BOSS直聘 ask-resume — request a candidate to share their attachment resume.
 *
 * Backed by the same /wapi/zpchat/exchange/request endpoint that exchange.js
 * already uses for phone (type=1) and wechat (type=2). This command issues
 * type=3, which the BOSS web UI surfaces as the "求简历" button.
 *
 * Field schema notes (#1068):
 * - OpenCLI exchange.js convention: type + securityId + uniqueId + name
 * - boss-agent-cli (Python) recruiter_client.exchange_request convention:
 *     type + uid + jobId + gid
 * - To stay forward compatible with both observations, this command sends
 *   the union of both schemas. Extra fields are ignored by the BOSS server
 *   for type=1/2 today; type=3 has been observed to require jobId on the
 *   Python side, so we keep it explicit here.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { requirePage, navigateToChat, bossFetch, findFriendByUid, verbose } from './utils.js';
cli({
    site: 'boss',
    name: 'ask-resume',
    access: 'write',
    description: 'BOSS直聘请求候选人分享附件简历（招聘端）',
    domain: 'www.zhipin.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    browser: true,
    args: [
        { name: 'uid', positional: true, required: true, help: 'Encrypted UID of the candidate (from chatlist)' },
        { name: 'job-id', default: '', help: 'Encrypted job id (optional; falls back to friend.encryptJobId)' },
    ],
    columns: ['status', 'detail'],
    func: async (page, kwargs) => {
        requirePage(page);
        verbose(`Requesting resume for ${kwargs.uid}...`);
        await navigateToChat(page);
        const friend = await findFriendByUid(page, kwargs.uid, { checkGreetList: true });
        if (!friend)
            throw new Error('未找到该候选人，请确认 uid 是否正确（可从 chatlist / recommend 命令获取）');
        const friendName = friend.name || '候选人';
        const jobId = kwargs['job-id'] || friend.encryptJobId || '';
        const params = new URLSearchParams({
            type: '3',
            // OpenCLI exchange.js convention
            securityId: friend.securityId || '',
            uniqueId: String(friend.uid),
            name: friendName,
            // boss-agent-cli recruiter_client convention (verified for type=3)
            uid: String(friend.uid),
            jobId,
            gid: String(friend.uid),
        });
        await bossFetch(page, 'https://www.zhipin.com/wapi/zpchat/exchange/request', {
            method: 'POST',
            body: params.toString(),
        });
        return [{
                status: '✅ 简历请求已发送',
                detail: `已向 ${friendName} 请求附件简历${jobId ? `（关联职位 ${jobId}）` : ''}`,
            }];
    },
});
