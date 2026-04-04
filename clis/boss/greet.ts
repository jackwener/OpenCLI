/**
 * BOSS直聘 greet — send greeting to a new candidate (initiate chat).
 */
import { cli, Strategy } from '../../registry.js';
import {
  requirePage, navigateToChat, findFriendByUid,
  clickCandidateInList, typeAndSendMessage, verbose,
} from './utils.js';

cli({
  site: 'boss',
  name: 'greet',
  description: 'BOSS直聘向新候选人发送招呼（开始聊天）',
  domain: 'www.zhipin.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  browser: true,
  args: [
    { name: 'uid', positional: true, required: true, help: 'Encrypted UID of the candidate (from recommend)' },
    { name: 'security-id', required: true, help: 'Security ID of the candidate' },
    { name: 'job-id', required: true, help: 'Encrypted job ID' },
    { name: 'text', default: '', help: 'Custom greeting message (uses default template if empty)' },
  ],
  columns: ['status', 'detail'],
  func: async (page, kwargs) => {
    requirePage(page);
    verbose(`Greeting candidate ${kwargs.uid}...`);

    await navigateToChat(page, 3);

    // Find candidate in greet list or friend list
    const friend = await findFriendByUid(page, kwargs.uid, {
      maxPages: 1,
      checkGreetList: true,
    });

    if (!friend) {
      throw new Error('未找到该候选人，请确认 uid 是否正确（可从 recommend 命令获取）');
    }

    const numericUid = friend.uid;
    const friendName = friend.name || '候选人';

    const clicked = await clickCandidateInList(page, numericUid);
    if (!clicked) {
      throw new Error('无法在聊天列表中找到该用户，候选人可能不在当前列表中');
    }

    await page.wait({ time: 2 });

    const msgText = kwargs.text || '你好，请问您对这个职位感兴趣吗？';
    const sent = await typeAndSendMessage(page, msgText);
    if (!sent) {
      throw new Error('找不到消息输入框');
    }

    await page.wait({ time: 1 });

    return [{ status: '✅ 招呼已发送', detail: `已向 ${friendName} 发送: ${msgText}` }];
  },
});
