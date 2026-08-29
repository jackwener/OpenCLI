import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { cleanupSubmissionScript, normalizeTimeout, responseAfterPromptScript, sendDoubaoMessage } from './utils.js';
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
        const timeout = normalizeTimeout(kwargs.timeout, 30);
        const submission = await sendDoubaoMessage(page, text, {
            timeoutMs: Math.min(timeout * 1000, 10_000),
            retainSubmission: true,
        });

        try {
            const deadline = Date.now() + timeout * 1000;
            let response = '';
            let stablePolls = 0;
            while (Date.now() < deadline) {
                await page.wait(0.5);
                const result = await page.evaluate(responseAfterPromptScript(text, submission.token));
                const candidate = result?.text || '';
                if (result?.phase === 'candidate' && candidate && candidate === response) stablePolls += 1;
                else stablePolls = 0;
                response = candidate;
                if (stablePolls >= 2) {
                    return [
                        { Role: 'User', Text: text },
                        { Role: 'Assistant', Text: response },
                    ];
                }
            }
            throw new CommandExecutionError(
                `Doubao prompt was sent, but reply completion is unknown after ${timeout}s`,
                'Run "opencli doubao-app read" before retrying; retrying ask may send the prompt twice.',
            );
        } finally {
            await page.evaluate(cleanupSubmissionScript(submission.token)).catch(() => {});
        }
    },
});
