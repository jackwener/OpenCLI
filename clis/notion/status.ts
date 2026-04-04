import { cli, Strategy } from '../../src/registry.js';
import type { IPage } from '../../src/types.js';

export const statusCommand = cli({
  site: 'notion',
  name: 'status',
  description: 'Check active CDP connection to Notion Desktop',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [],
  columns: ['Status', 'Url', 'Title'],
  func: async (page: IPage) => {
    const url = await page.evaluate('window.location.href');
    const title = await page.evaluate('document.title');
    return [{ Status: 'Connected', Url: url, Title: title }];
  },
});
