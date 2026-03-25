import { cli, Strategy } from '../../registry.js';
import { SelectorError } from '../../errors.js';
import type { IPage } from '../../types.js';
import { ensureChatbotPage, injectChatText, resolveConnectionId } from './_shared.js';

export const sendCommand = cli({
  site: 'dory',
  name: 'send',
  description: 'Send a message to the active Dory chat composer',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'text', required: true, positional: true, help: 'Message text to send' },
    { name: 'connection', required: false, help: 'Connection name or ID to navigate to before sending' },
  ],
  columns: ['Status', 'InjectedText'],
  func: async (page: IPage, kwargs: any) => {
    const text = kwargs.text as string;
    const rawConn = kwargs.connection as string | undefined;
    const connectionId = rawConn ? await resolveConnectionId(page, rawConn) : undefined;

    await ensureChatbotPage(page, connectionId);

    const injected = await injectChatText(page, text);
    if (!injected) throw new SelectorError('Dory chat textarea');

    await page.wait(0.3);
    await page.pressKey('Enter');

    return [{ Status: 'Success', InjectedText: text }];
  },
});
