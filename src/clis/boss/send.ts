/**
 * BOSS直聘 send message — via UI automation on chat page.
 *
 * BOSS chat uses MQTT (not HTTP) for messaging, so we must go through the UI
 * rather than making direct API calls.
 */
import { cli, Strategy } from '../../registry.js';
import {
  requirePage, navigateToChat, findFriendByUid,
  clickCandidateInList, typeAndSendMessage,
} from './common.js';

cli({
  site: 'boss',
  name: 'send',
  description: 'BOSS直聘发送聊天消息',
  domain: 'www.zhipin.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  browser: true,
  args: [
    { name: 'uid', required: true, help: 'Encrypted UID of the candidate (from chatlist)' },
    { name: 'text', required: true, positional: true, help: 'Message text to send' },
  ],
  columns: ['status', 'detail'],
  func: async (page, kwargs) => {
    requirePage(page);

    await navigateToChat(page, 3);

    const friend = await findFriendByUid(page, kwargs.uid, { maxPages: 5 });
    if (!friend) throw new Error('未找到该候选人，请确认 uid 是否正确');

    const numericUid = friend.uid;
    const friendName = friend.name || '候选人';

    const clicked = await clickCandidateInList(page, numericUid);
    if (!clicked) {
      throw new Error('无法在聊天列表中找到该用户，请确认聊天列表中有此人');
    }

    await page.wait({ time: 2 });

    const sent = await typeAndSendMessage(page, kwargs.text);
    if (!sent) {
      throw new Error('找不到消息输入框');
    }

    await page.wait({ time: 1 });

    return [{ status: '✅ 发送成功', detail: `已向 ${friendName} 发送: ${kwargs.text}` }];
  },
});
