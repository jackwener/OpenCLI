import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { GEMINI_DOMAIN, readGeminiSnapshot, sendGeminiMessage, startNewGeminiChat, waitForGeminiResponse, waitForGeminiSubmission } from './utils.js';
function normalizeBooleanFlag(value) {
    if (typeof value === 'boolean')
        return value;
    const normalized = String(value ?? '').trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}
const NO_RESPONSE_PREFIX = '[NO RESPONSE]';
export const askCommand = cli({
    site: 'gemini',
    name: 'ask',
    access: 'write',
    description: 'Send a prompt to Gemini and return only the assistant response',
    domain: GEMINI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    defaultFormat: 'plain',
    args: [
        { name: 'prompt', required: true, positional: true, help: 'Prompt to send' },
        { name: 'timeout', type: 'int', required: false, help: 'Max seconds to wait (default: 60)', default: 60 },
        { name: 'new', required: false, help: 'Start a new chat first (true/false, default: false)', default: 'false' },
    ],
    columns: ['response'],
    func: async (page, kwargs) => {
        const prompt = kwargs.prompt;
        const timeout = kwargs.timeout;
        if (!Number.isInteger(timeout) || timeout < 1) {
            throw new ArgumentError('--timeout must be a positive integer (seconds)');
        }
        const startFresh = normalizeBooleanFlag(kwargs.new);
        if (startFresh)
            await startNewGeminiChat(page);
        const before = await readGeminiSnapshot(page);
        await sendGeminiMessage(page, prompt);
        const submissionStartedAt = Date.now();
        const submitted = await waitForGeminiSubmission(page, before, timeout);
        if (!submitted) {
            return [{ response: `💬 ${NO_RESPONSE_PREFIX} No Gemini response within ${timeout}s.` }];
        }
        const remainingTimeoutSeconds = Math.max(0, timeout - Math.ceil((Date.now() - submissionStartedAt) / 1000));
        const response = await waitForGeminiResponse(page, submitted, prompt, remainingTimeoutSeconds);
        if (!response) {
            return [{ response: `💬 ${NO_RESPONSE_PREFIX} No Gemini response within ${timeout}s.` }];
        }
        return [{ response: `💬 ${response}` }];
    },
});
