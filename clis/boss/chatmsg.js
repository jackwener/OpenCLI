import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    requirePage, navigateToChat, navigateToGeekChat,
    bossFetch, findFriendByUid, findGeekFriendByUid,
    fetchGeekHistoryMsg, readEncryptSystemId,
    assertOk, IDENTITY_MISMATCH_CODE,
} from './utils.js';

const TYPE_MAP = {
    1: '文本', 2: '图片', 3: '招呼', 4: '简历', 5: '系统',
    6: '名片', 7: '语音', 8: '视频', 9: '表情',
};

function mapBossMsg(m, friend) {
    const fromObj = m.from || {};
    const isSelf = typeof fromObj === 'object' ? fromObj.uid !== friend.uid : false;
    return {
        from: isSelf ? '我' : (typeof fromObj === 'object' ? fromObj.name : friend.name),
        type: TYPE_MAP[m.type] || `其他(${m.type})`,
        text: m.text || m.body?.text || '',
        time: m.time ? new Date(m.time).toLocaleString('zh-CN') : '',
    };
}

function mapGeekMsg(m, friend) {
    const fromUid = m.from && m.from.uid;
    const isFromBoss = fromUid != null && String(fromUid) === String(friend.uid);
    return {
        from: isFromBoss ? '对方' : '我',
        type: TYPE_MAP[m.type] || `其他(${m.type})`,
        text: m.text || m.body?.text || m.body?.content || m.body?.showText ||
            JSON.stringify(m.body || {}).slice(0, 120),
        time: m.time ? new Date(m.time).toLocaleString('zh-CN') : '',
    };
}

async function bossChatMsg(page, kwargs, existingFriend) {
    const friend = existingFriend ?? await findFriendByUid(page, kwargs.uid);
    if (!friend) throw new Error('未找到该候选人');
    const gid = friend.uid;
    const securityId = encodeURIComponent(friend.securityId);
    const msgUrl = `https://www.zhipin.com/wapi/zpchat/boss/historyMsg?gid=${gid}&securityId=${securityId}&page=${kwargs.page}&c=20&src=0`;
    const msgData = await bossFetch(page, msgUrl);
    const messages = msgData.zpData?.messages || msgData.zpData?.historyMsgList || [];
    return messages.map((m) => mapBossMsg(m, friend));
}

async function geekChatMsg(page, kwargs, encryptSystemId) {
    const friend = await findGeekFriendByUid(page, kwargs.uid, { encryptSystemId });
    if (!friend) throw new Error('未找到该聊天（geek 侧）');
    if (!friend.securityId) throw new Error('该聊天缺少 securityId，无法获取历史消息');
    const messages = await fetchGeekHistoryMsg(page, friend, { page: kwargs.page });
    return messages.map((m) => mapGeekMsg(m, friend));
}

cli({
    site: 'boss',
    name: 'chatmsg',
    access: 'read',
    description: 'BOSS直聘查看聊天消息历史（招聘端/求职端）',
    domain: 'www.zhipin.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    browser: true,
    args: [
        { name: 'uid', required: true, positional: true, help: 'Encrypted UID (from chatlist)' },
        { name: 'page', type: 'int', default: 1, help: 'Page number' },
        { name: 'side', default: 'auto', choices: ['auto', 'boss', 'geek'], help: 'Identity side: auto (default), boss (recruiter), or geek (job-seeker)' },
    ],
    columns: ['from', 'type', 'text', 'time'],
    func: async (page, kwargs) => {
        requirePage(page);
        const side = kwargs.side || 'auto';

        if (side === 'boss') {
            await navigateToChat(page);
            return await bossChatMsg(page, kwargs);
        }

        if (side === 'geek') {
            await navigateToGeekChat(page);
            const encryptSystemId = await readEncryptSystemId(page);
            return await geekChatMsg(page, kwargs, encryptSystemId);
        }

        // auto: try recruiter first, fall back to geek when not found or identity mismatch
        await navigateToChat(page);
        const bossResult = await findFriendByUid(page, kwargs.uid, { allowNonZero: true });
        if (bossResult?.friend) {
            return await bossChatMsg(page, kwargs, bossResult.friend);
        }
        // Not found or identity mismatch — check for hard errors before falling back
        if (bossResult?.code && bossResult.code !== 0 && bossResult.code !== IDENTITY_MISMATCH_CODE) {
            assertOk(bossResult);
        }
        // Fall back to geek side
        await navigateToGeekChat(page);
        const encryptSystemId = await readEncryptSystemId(page);
        const geekFriend = await findGeekFriendByUid(page, kwargs.uid, { encryptSystemId });
        if (!geekFriend) throw new Error('uid 在招聘端与求职端聊天列表中均未找到');
        if (!geekFriend.securityId) throw new Error('该聊天缺少 securityId，无法获取历史消息');
        const messages = await fetchGeekHistoryMsg(page, geekFriend, { page: kwargs.page });
        return messages.map((m) => mapGeekMsg(m, geekFriend));
    },
});
