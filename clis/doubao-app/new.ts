import { cli, Strategy } from '@jackwener/opencli/registry';
import { clickNewChatScript } from './utils.js';

export const newCommand = cli({
  site: 'doubao-app',
  name: 'new',
  description: 'Start a new chat in Doubao desktop app',
  domain: 'doubao-app',
  strategy: Strategy.UI,
  browser: true,
  args: [],
  columns: ['Status'],
  func: async (page) => {
    const clicked = await page.evaluate(clickNewChatScript());
    if (!clicked) {
      await page.pressKey('Meta+N');
    }
    await page.wait(3);
    return [{ Status: 'Success' }];
  },
});