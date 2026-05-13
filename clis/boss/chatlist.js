import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    requirePage, navigateToChat, navigateToGeekChat,
    fetchFriendList, fetchGeekFriendLabelList, fetchGeekFriendInfoList,
    readEncryptSystemId, assertOk, IDENTITY_MISMATCH_CODE,
} from './utils.js';

function formatMsgTime(ms) {
    if (!ms) return '';
    return new Date(ms).toLocaleString('zh-CN');
}

function mapBossRow(f) {
    return {
        name: f.name || '',
        company: '',
        job: f.jobName || '',
        title: '',
        last_msg: f.lastMessageInfo?.text || '',
        last_time: f.lastTime || '',
        uid: f.encryptUid || '',
        security_id: f.securityId || '',
    };
}

async function buildGeekRows(page, limit) {
    const encryptSystemId = await readEncryptSystemId(page);
    const labelList = await fetchGeekFriendLabelList(page, { encryptSystemId });
    const slicedLabels = labelList.slice(0, limit);
    const friendIds = slicedLabels.map((f) => f.friendId).filter(Boolean);
    const enriched = await fetchGeekFriendInfoList(page, friendIds);
    const enrichMap = new Map(enriched.map((f) => [String(f.friendId ?? f.uid), f]));
    return slicedLabels.map((f) => {
        const e = enrichMap.get(String(f.friendId)) || {};
        return {
            name: e.name || f.name || '',
            company: e.brandName || f.brandName || '',
            job: e.jobName || f.jobName || '',
            title: e.bossTitle || f.bossTitle || '',
            last_msg: e.lastMessageInfo?.showText || e.lastMsg || f.lastMsg || '',
            last_time: e.lastTime || formatMsgTime(e.lastMessageInfo?.msgTime) || formatMsgTime(f.updateTime) || '',
            uid: e.encryptUid || f.encryptFriendId || String(e.uid ?? e.friendId ?? f.friendId ?? ''),
            security_id: e.securityId || '',
        };
    });
}

cli({
    site: 'boss',
    name: 'chatlist',
    access: 'read',
    description: 'BOSS直聘查看聊天列表（招聘端/求职端）',
    domain: 'www.zhipin.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    browser: true,
    args: [
        { name: 'page', type: 'int', default: 1, help: 'Page number' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of results' },
        { name: 'job-id', default: '0', help: 'Filter by job ID (0=all, boss side only)' },
        { name: 'side', default: 'auto', choices: ['auto', 'boss', 'geek'], help: 'Identity side: auto (default), boss (recruiter), or geek (job-seeker)' },
    ],
    columns: ['name', 'company', 'job', 'title', 'last_msg', 'last_time', 'uid', 'security_id'],
    func: async (page, kwargs) => {
        requirePage(page);
        const limit = kwargs.limit || 20;
        const side = kwargs.side || 'auto';

        if (side === 'boss') {
            await navigateToChat(page);
            const friends = await fetchFriendList(page, {
                pageNum: kwargs.page || 1,
                jobId: kwargs['job-id'] || '0',
            });
            return friends.slice(0, limit).map(mapBossRow);
        }

        if (side === 'geek') {
            await navigateToGeekChat(page);
            return await buildGeekRows(page, limit);
        }

        // auto: try recruiter first, fall back to geek on identity mismatch
        await navigateToChat(page);
        const bossResult = await fetchFriendList(page, {
            pageNum: kwargs.page || 1,
            jobId: kwargs['job-id'] || '0',
            allowNonZero: true,
        });
        if (Array.isArray(bossResult)) {
            return bossResult.slice(0, limit).map(mapBossRow);
        }
        if (bossResult.code === IDENTITY_MISMATCH_CODE) {
            await navigateToGeekChat(page);
            return await buildGeekRows(page, limit);
        }
        assertOk(bossResult);
    },
});
