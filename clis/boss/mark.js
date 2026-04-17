/**
 * BOSS直聘 mark — label/mark a candidate.
 *
 * Available labels:
 *   1=新招呼, 2=沟通中, 3=已约面, 4=已获取简历, 5=已交换电话,
 *   6=已交换微信, 7=不合适, 8=牛人发起, 11=收藏
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { requirePage, navigateToChat, bossFetch, findFriendByUid, verbose } from './utils.js';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
const LABEL_MAP = {
    '新招呼': 1, '沟通中': 2, '已约面': 3, '已获取简历': 4,
    '已交换电话': 5, '已交换微信': 6, '不合适': 7, '牛人发起': 8, '收藏': 11,
};
cli({
    site: 'boss',
    name: 'mark',
    description: 'BOSS直聘给候选人添加标签',
    domain: 'www.zhipin.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    browser: true,
    args: [
        { name: 'uid', positional: true, required: true, help: 'Encrypted UID of the candidate' },
        { name: 'label', required: true, help: 'Label name (新招呼/沟通中/已约面/已获取简历/已交换电话/已交换微信/不合适/收藏) or label ID' },
        { name: 'remove', type: 'boolean', default: false, help: 'Remove the label instead of adding' },
    ],
    columns: ['status', 'detail'],
    func: async (page, kwargs) => {
        requirePage(page);
        const labelInput = kwargs.label;
        const remove = kwargs.remove || false;
        // Resolve label to ID
        let labelId;
        if (LABEL_MAP[labelInput]) {
            labelId = LABEL_MAP[labelInput];
        }
        else if (!isNaN(Number(labelInput))) {
            labelId = Number(labelInput);
        }
        else {
            const entry = Object.entries(LABEL_MAP).find(([k]) => k.includes(labelInput));
            if (entry) {
                labelId = entry[1];
            }
            else {
                throw new ArgumentError(`未知标签: ${labelInput}。可用标签: ${Object.keys(LABEL_MAP).join(', ')}`);
            }
        }
        verbose(`${remove ? 'Removing' : 'Adding'} label ${labelId} for ${kwargs.uid}...`);
        await navigateToChat(page);
        const friend = await findFriendByUid(page, kwargs.uid, { checkGreetList: true });
        if (!friend)
            throw new EmptyResultError('boss candidate search');
        const friendName = friend.name || '候选人';
        const action = remove ? 'deleteMark' : 'addMark';
        const params = new URLSearchParams({
            friendId: String(friend.uid),
            friendSource: String(friend.friendSource ?? 0),
            labelId: String(labelId),
        });
        await bossFetch(page, `https://www.zhipin.com/wapi/zprelation/friend/label/${action}?${params.toString()}`);
        const labelName = Object.entries(LABEL_MAP).find(([, v]) => v === labelId)?.[0] || String(labelId);
        return [{
                status: remove ? '✅ 标签已移除' : '✅ 标签已添加',
                detail: `${friendName}: ${remove ? '移除' : '添加'}标签「${labelName}」`,
            }];
    },
});
