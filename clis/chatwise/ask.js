import { cli, Strategy } from '@jackwener/opencli/registry';
import { selectorError, TimeoutError } from '@jackwener/opencli/errors';
import {
    buildChatwiseInjectTextJs,
    buildChatwiseMessageCountJs,
    buildChatwiseResponseAfterJs,
    normalizeTimeout,
} from './utils.js';
export const askCommand = cli({
    site: 'chatwise',
    name: 'ask',
    access: 'write',
    description: 'Send a prompt and wait for the AI response (send + wait + read)',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'text', required: true, positional: true, help: 'Prompt to send' },
        { name: 'timeout', required: false, help: 'Max seconds to wait (default: 30)', default: '30' },
    ],
    columns: ['Role', 'Text'],
    func: async (page, kwargs) => {
        const text = kwargs.text;
        const timeout = normalizeTimeout(kwargs.timeout);
        // Snapshot content length
        const beforeLen = await page.evaluate(buildChatwiseMessageCountJs());
        // Send message
        const injected = await page.evaluate(buildChatwiseInjectTextJs(text));
        if (!injected)
            throw selectorError('ChatWise input element');
        await page.wait(0.5);
        await page.pressKey('Enter');
        // Poll for response
        const pollInterval = 2;
        const maxPolls = Math.ceil(timeout / pollInterval);
        let response = '';
        for (let i = 0; i < maxPolls; i++) {
            await page.wait(pollInterval);
            const result = await page.evaluate(buildChatwiseResponseAfterJs(beforeLen, text));
            if (result) {
                const next = String(result).trim();
                if (next === response) break;
                response = next;
            }
        }
        if (!response) {
            throw new TimeoutError('ChatWise response', timeout, 'Confirm ChatWise is done generating, then retry with a larger --timeout if needed.');
        }
        return [
            { Role: 'User', Text: text },
            { Role: 'Assistant', Text: response },
        ];
    },
});
