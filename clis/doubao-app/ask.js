import { cli, Strategy } from '@jackwener/opencli/registry';
import { SEL, injectTextScript, clickSendScript, pollResponseScript } from './utils.js';
export const askCommand = cli({
    site: 'doubao-app',
    name: 'ask',
    access: 'write',
    description: 'Send a message to Doubao desktop app and wait for the AI response',
    domain: 'doubao-app',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'text', required: true, positional: true, help: 'Prompt to send' },
        { name: 'timeout', type: 'int', default: 30, help: 'Max seconds to wait for response' },
    ],
    columns: ['Role', 'Text'],
    func: async (page, kwargs) => {
        const text = kwargs.text;
        const timeout = kwargs.timeout || 30;
        // Count existing messages before sending
        const beforeCount = await page.evaluate(`document.querySelectorAll('${SEL.MESSAGE}').length`);
        // Inject text + send
        const injected = await page.evaluate(injectTextScript(text));
        if (!injected?.ok)
            throw new Error('Could not find chat input.');
        await page.wait(0.5);
        const clicked = await page.evaluate(clickSendScript());
        if (!clicked)
            await page.pressKey('Enter');
        // Poll for response
        const pollInterval = 1;
        const maxPolls = Math.ceil(timeout / pollInterval);
        let response = '';
        for (let i = 0; i < maxPolls; i++) {
            await page.wait(pollInterval);
            const result = await page.evaluate(pollResponseScript(beforeCount));
            if (!result)
                continue;
            if (result.phase === 'done' && result.text) {
                response = result.text;
                break;
            }
        }
        if (!response) {
            return [
                { Role: 'User', Text: text },
                { Role: 'System', Text: `No response received within ${timeout}s.` },
            ];
        }
        return [
            { Role: 'User', Text: text },
            { Role: 'Assistant', Text: response },
        ];
    },
});
