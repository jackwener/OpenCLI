import { CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { fetchThread, parseAccount } from './utils.js';

cli({
  site: 'gmail',
  name: 'thread',
  access: 'read',
  description: 'Read every message in a Gmail thread',
  domain: 'mail.google.com',
  strategy: Strategy.INTERCEPT,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  args: [
    { name: 'thread', type: 'string', positional: true, required: true, help: 'Thread id from gmail search, legacy id, or Gmail thread URL' },
    { name: 'account', type: 'int', default: 0, help: 'Gmail account index from the /mail/u/<index>/ URL' },
  ],
  columns: [
    'messageId', 'legacyMessageId', 'threadId', 'subject', 'from', 'fromName',
    'to', 'cc', 'date', 'snippet', 'body', 'attachments',
  ],
  func: async (page, kwargs) => {
    if (!page) throw new CommandExecutionError('Browser session required for gmail thread');
    return fetchThread(page, kwargs.thread, parseAccount(kwargs.account));
  },
});
