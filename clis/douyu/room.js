import { cli, Strategy } from '@jackwener/opencli/registry';
import { fetchDouyuText, parseRoomSummary } from './public-utils.js';
import { normalizeRoom } from './utils.js';
import { EmptyResultError } from '@jackwener/opencli/errors';

export const command = cli({
  site: 'douyu',
  name: 'room',
  description: '获取斗鱼直播间公开信息',
  access: 'read',
  example: 'opencli douyu room 6979222 -f yaml',
  domain: 'www.douyu.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'room', required: true, positional: true, help: 'Douyu room id or room URL' },
  ],
  columns: ['room', 'title', 'anchor', 'category', 'online', 'url'],
  func: async (kwargs) => {
    const room = normalizeRoom(kwargs.room);
    const html = await fetchDouyuText(`https://www.douyu.com/${room}`);
    const summary = parseRoomSummary(html, room);
    if (!summary.title) {
      throw new EmptyResultError('douyu room', `Failed to parse Douyu room ${room}`);
    }
    return [summary];
  },
});
