import { cli, Strategy } from '../../src/registry.js';
import { injectTextScript, clickSendScript } from './utils.js';

export const sendCommand = cli({
  site: 'doubao-app',
  name: 'send',
  description: 'Send a message to Doubao desktop app',
  domain: 'doubao-app',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'text', required: true, positional: true, help: 'Message text to send' },
  ],
  columns: ['Status', 'Text'],
  func: async (page, kwargs) => {
    const text = kwargs.text as string;

    const injected = await page.evaluate(injectTextScript(text));
    if (!injected || !injected.ok) {
      throw new Error('Could not find chat input: ' + (injected?.error || 'unknown'));
    }
    await page.wait(0.5);

    const clicked = await page.evaluate(clickSendScript());
    if (!clicked) await page.pressKey('Enter');

    await page.wait(1);
    return [{ Status: 'Sent', Text: text }];
  },
});