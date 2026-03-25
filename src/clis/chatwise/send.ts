import { cli, Strategy } from '../../registry.js';
import { SelectorError } from '../../errors.js';
import type { IPage } from '../../types.js';
import { chatwiseRequiredEnv } from './shared.js';
import { buildChatwiseInjectTextJs } from './utils.js';

export const sendCommand = cli({
  site: 'chatwise',
  name: 'send',
  description: 'Send a message to the active ChatWise conversation',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  requiredEnv: chatwiseRequiredEnv,
  args: [{ name: 'text', required: true, positional: true, help: 'Message to send' }],
  columns: ['Status', 'InjectedText'],
  func: async (page: IPage, kwargs: any) => {
    const text = kwargs.text as string;

    const injected = await page.evaluate(buildChatwiseInjectTextJs(text));
    if (!injected) throw new SelectorError('ChatWise input element');

    await page.wait(0.5);
    await page.pressKey('Enter');

    return [
      {
        Status: 'Success',
        InjectedText: text,
      },
    ];
  },
});
