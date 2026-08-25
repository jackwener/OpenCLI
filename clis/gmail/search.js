import { CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { parseAccount, parseLimit, queryThreads } from './utils.js';

const THREAD_COLUMNS = [
  'threadId', 'subject', 'from', 'fromName', 'snippet', 'messageCount',
  'unread', 'starred', 'date', 'labels',
];

function requirePage(page, command) {
  if (!page) throw new CommandExecutionError(`Browser session required for gmail ${command}`);
  return page;
}

const commonArgs = [
  { name: 'limit', type: 'int', default: 20, help: 'Maximum threads to return (1-200)' },
  { name: 'account', type: 'int', default: 0, help: 'Gmail account index from the /mail/u/<index>/ URL' },
];

function registerThreadQuery(name, description, query) {
  cli({
    site: 'gmail',
    name,
    access: 'read',
    description,
    domain: 'mail.google.com',
    strategy: Strategy.INTERCEPT,
    browser: true,
    navigateBefore: false,
    siteSession: 'persistent',
    args: commonArgs,
    columns: THREAD_COLUMNS,
    func: async (page, kwargs) => queryThreads(requirePage(page, name), query, {
      account: parseAccount(kwargs.account),
      limit: parseLimit(kwargs.limit),
    }),
  });
}

cli({
  site: 'gmail',
  name: 'search',
  access: 'read',
  description: 'Search Gmail using Gmail search syntax',
  domain: 'mail.google.com',
  strategy: Strategy.INTERCEPT,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  args: [
    { name: 'query', type: 'string', positional: true, required: true, help: 'Gmail search query' },
    ...commonArgs,
  ],
  columns: THREAD_COLUMNS,
  func: async (page, kwargs) => queryThreads(requirePage(page, 'search'), kwargs.query, {
    account: parseAccount(kwargs.account),
    limit: parseLimit(kwargs.limit),
  }),
});

registerThreadQuery('inbox', 'List Gmail inbox threads', 'in:inbox');
registerThreadQuery('unread', 'List unread Gmail threads', 'is:unread');
registerThreadQuery('starred', 'List starred Gmail threads', 'is:starred');
registerThreadQuery('sent', 'List sent Gmail threads', 'in:sent');
registerThreadQuery('drafts', 'List Gmail draft threads', 'in:drafts');
registerThreadQuery('trash', 'List Gmail trash threads', 'in:trash');
registerThreadQuery('spam', 'List Gmail spam threads', 'in:spam');
registerThreadQuery('snoozed', 'List snoozed Gmail threads', 'is:snoozed');
registerThreadQuery('important', 'List important Gmail threads', 'is:important');
