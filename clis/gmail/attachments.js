import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { fetchThread, parseAccount } from './utils.js';

cli({
  site: 'gmail',
  name: 'attachments',
  access: 'read',
  description: 'List attachment metadata for a Gmail thread',
  domain: 'mail.google.com',
  strategy: Strategy.INTERCEPT,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  args: [
    { name: 'thread', type: 'string', positional: true, required: true, help: 'Thread id from gmail search, legacy id, or Gmail thread URL' },
    { name: 'account', type: 'int', default: 0, help: 'Gmail account index from the /mail/u/<index>/ URL' },
  ],
  columns: ['messageId', 'attachmentId', 'name', 'mimeType', 'size'],
  func: async (page, kwargs) => {
    if (!page) throw new CommandExecutionError('Browser session required for gmail attachments');
    const messages = await fetchThread(page, kwargs.thread, parseAccount(kwargs.account));
    const rows = messages.flatMap((message) => message.attachments.map((attachment) => ({
      messageId: message.messageId,
      ...attachment,
    })));
    if (rows.length === 0) {
      throw new EmptyResultError('gmail attachments', 'The Gmail thread has no attachments');
    }
    return rows;
  },
});
