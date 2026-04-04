import { cli, Strategy } from '../../src/registry.js';
import type { IPage } from '../../src/types.js';
import { DOUBAO_DOMAIN, DOUBAO_CHAT_URL, sendDoubaoMessage } from './utils.js';

export const sendCommand = cli({
  site: 'doubao',
  name: 'send',
  description: 'Send a message to Doubao web chat',
  domain: DOUBAO_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [{ name: 'text', required: true, positional: true, help: 'Message to send' }],
  columns: ['Status', 'SubmittedBy', 'InjectedText'],
  func: async (page: IPage, kwargs: any) => {
    const text = kwargs.text as string;
    const submittedBy = await sendDoubaoMessage(page, text);

    return [{
      Status: 'Success',
      SubmittedBy: submittedBy,
      InjectedText: text,
    }];
  },
});
