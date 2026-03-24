/**
 * BOSS直聘 exchange — request phone/wechat exchange with a candidate.
 */
import { cli, Strategy } from '../../registry.js';
import { requirePage, navigateToChat, bossFetch, findFriendByUid, verbose } from './utils.js';

cli({
  site: 'boss',
  name: 'exchange',
  description: 'BOSS直聘交换联系方式（请求手机/微信）',
  domain: 'www.zhipin.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  browser: true,
  args: [
    { name: 'uid', required: true, positional: true, help: 'Encrypted UID of the candidate' },
    { name: 'type', default: 'phone', choices: ['phone', 'wechat'], help: 'Exchange type: phone or wechat' },
  ],
  columns: ['status', 'detail'],
  func: async (page, kwargs) => {
    requirePage(page);

    const exchangeType = kwargs.type || 'phone';
    verbose(`Requesting ${exchangeType} exchange for ${kwargs.uid}...`);

    await navigateToChat(page);

    const friend = await findFriendByUid(page, kwargs.uid, { checkGreetList: true });
    if (!friend) throw new Error('未找到该候选人');

    const friendName = friend.name || '候选人';
    const typeId = exchangeType === 'wechat' ? 2 : 1;

    const params = new URLSearchParams({
      type: String(typeId),
      securityId: friend.securityId || '',
      uniqueId: String(friend.uid),
      name: friendName,
    });

    await bossFetch(page, 'https://www.zhipin.com/wapi/zpchat/exchange/request', {
      method: 'POST',
      body: params.toString(),
    });

    const typeLabel = exchangeType === 'wechat' ? '微信' : '手机号';
    return [{
      status: '✅ 交换请求已发送',
      detail: `已向 ${friendName} 发送${typeLabel}交换请求`,
    }];
  },
});
