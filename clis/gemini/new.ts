import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { GEMINI_DOMAIN, startNewGeminiChat } from './utils.js';

export const newCommand = cli({
  site: 'gemini',
  name: 'new',
  description: 'Start a new conversation in Gemini web chat',
  domain: GEMINI_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [],
  columns: ['Status', 'Action'],
  func: async (page: IPage) => {
    const action = await startNewGeminiChat(page);
    return [{
      Status: 'Success',
      Action: action === 'navigate' ? 'Reloaded /app as fallback' : 'Clicked New chat',
    }];
  },
});
