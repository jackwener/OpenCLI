/**
 * BOSS直聘 invite — send interview invitation to a candidate.
 */
import { cli, Strategy } from '../../registry.js';
import { requirePage, navigateToChat, bossFetch, findFriendByUid, verbose } from './utils.js';

cli({
  site: 'boss',
  name: 'invite',
  description: 'BOSS直聘发送面试邀请',
  domain: 'www.zhipin.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  browser: true,
  args: [
    { name: 'uid', positional: true, required: true, help: 'Encrypted UID of the candidate' },
    { name: 'time', required: true, help: 'Interview time (e.g. 2025-04-01 14:00)' },
    { name: 'address', default: '', help: 'Interview address (uses saved address if empty)' },
    { name: 'contact', default: '', help: 'Contact person name (uses saved contact if empty)' },
  ],
  columns: ['status', 'detail'],
  func: async (page, kwargs) => {
    requirePage(page);
    verbose(`Sending interview invitation to ${kwargs.uid}...`);

    await navigateToChat(page);

    const friend = await findFriendByUid(page, kwargs.uid, { checkGreetList: true });
    if (!friend) throw new Error('未找到该候选人');

    const friendName = friend.name || '候选人';

    // Get saved contact info
    const contactData = await bossFetch(
      page,
      'https://www.zhipin.com/wapi/zpinterview/boss/interview/contactInit',
      { allowNonZero: true, timeout: 10_000 },
    );
    const contactName = kwargs.contact || contactData.zpData?.contactName || '';
    const contactPhone = contactData.zpData?.contactPhone || '';
    const contactId = contactData.zpData?.contactId || '';

    // Get saved address
    const addressData = await bossFetch(
      page,
      'https://www.zhipin.com/wapi/zpinterview/boss/interview/listAddress',
      { allowNonZero: true, timeout: 10_000 },
    );
    const savedAddress = addressData.zpData?.list?.[0] || {};
    const addressText = kwargs.address || savedAddress.cityAddressText || savedAddress.addressText || '';

    // Parse interview time
    const interviewTime = new Date(kwargs.time).getTime();
    if (isNaN(interviewTime)) {
      throw new Error(`时间格式错误: ${kwargs.time}，请使用格式如 2025-04-01 14:00`);
    }

    const params = new URLSearchParams({
      uid: String(friend.uid),
      securityId: friend.securityId || '',
      encryptJobId: friend.encryptJobId || '',
      interviewTime: String(interviewTime),
      contactId,
      contactName,
      contactPhone,
      address: addressText,
      interviewType: '1',
    });

    await bossFetch(page, 'https://www.zhipin.com/wapi/zpinterview/boss/interview/invite.json', {
      method: 'POST',
      body: params.toString(),
    });

    return [{
      status: '✅ 面试邀请已发送',
      detail: `已向 ${friendName} 发送面试邀请\n时间: ${kwargs.time}\n地点: ${addressText}\n联系人: ${contactName}`,
    }];
  },
});
