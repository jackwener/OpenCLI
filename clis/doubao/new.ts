import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/types';
import { DOUBAO_DOMAIN, DOUBAO_CHAT_URL, startNewDoubaoChat } from './utils.js';

export const newCommand = cli({
  site: 'doubao',
  name: 'new',
  description: 'Start a new conversation in Doubao web chat',
  domain: DOUBAO_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [],
  columns: ['Status', 'Action'],
  func: async (page: IPage) => {
    const action = await startNewDoubaoChat(page);
    return [{
      Status: 'Success',
      Action: action === 'navigate' ? 'Reloaded /chat as fallback' : `Clicked ${action}`,
    }];
  },
});
