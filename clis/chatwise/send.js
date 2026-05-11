import { cli, Strategy } from '@jackwener/opencli/registry';
import { selectorError } from '@jackwener/opencli/errors';
import { buildChatwiseInjectTextJs } from './utils.js';
export const sendCommand = cli({
    site: 'chatwise',
    name: 'send',
    access: 'write',
    description: 'Send a message to the active ChatWise conversation',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [{ name: 'text', required: true, positional: true, help: 'Message to send' }],
    columns: ['Status', 'InjectedText'],
    func: async (page, kwargs) => {
        const text = kwargs.text;
        const injected = await page.evaluate(buildChatwiseInjectTextJs(text));
        if (!injected)
            throw selectorError('ChatWise input element');
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
