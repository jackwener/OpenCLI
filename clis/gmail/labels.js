import { CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { listLabels, parseAccount } from './utils.js';

cli({
  site: 'gmail',
  name: 'labels',
  access: 'read',
  description: 'List Gmail system and user labels with counts',
  domain: 'mail.google.com',
  strategy: Strategy.INTERCEPT,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  args: [
    { name: 'account', type: 'int', default: 0, help: 'Gmail account index from the /mail/u/<index>/ URL' },
  ],
  columns: ['id', 'name', 'type', 'unreadCount', 'totalCount'],
  func: async (page, kwargs) => {
    if (!page) throw new CommandExecutionError('Browser session required for gmail labels');
    return listLabels(page, parseAccount(kwargs.account));
  },
});
