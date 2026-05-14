import { cli, Strategy } from '@jackwener/opencli/registry';
import { extractRoomSummary, gotoRoom, ensureRoomReady } from './utils.js';

export const command = cli({
  site: 'douyu',
  name: 'watch',
  description: '打开斗鱼直播间并返回当前直播状态',
  access: 'read',
  example: 'opencli douyu watch 6979222 -f yaml',
  domain: 'www.douyu.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  args: [
    { name: 'room', required: true, positional: true, help: 'Douyu room id or room URL' },
  ],
  columns: ['room', 'title', 'streamer', 'category', 'followers', 'live_status', 'live_status_reason', 'video_status', 'url'],
  func: async (page, kwargs) => {
    await gotoRoom(page, kwargs.room);
    await ensureRoomReady(page);
    return [await extractRoomSummary(page)];
  },
});
