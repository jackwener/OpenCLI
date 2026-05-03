import { cli, Strategy } from '@jackwener/opencli/registry';
import { GEMINI_DOMAIN, readGeminiSnapshot, sendGeminiMessage, startNewGeminiChat, waitForGeminiResponse, waitForGeminiSubmission } from './utils.js';
export function parseGeminiAskTimeout(value, fallback) {
    const parsed = parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function normalizeBooleanFlag(value) {
    if (typeof value === 'boolean')
        return value;
    const normalized = String(value ?? '').trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}
export const DEFAULT_GEMINI_ASK_TIMEOUT_SECONDS = parseGeminiAskTimeout(process.env.OPENCLI_GEMINI_ASK_TIMEOUT, 60);
const GEMINI_ASK_COMMAND_TIMEOUT_SECONDS = 3600;
const NO_RESPONSE_PREFIX = '[NO RESPONSE]';
export const askCommand = cli({
    site: 'gemini',
    name: 'ask',
    description: 'Send a prompt to Gemini and return only the assistant response',
    domain: GEMINI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    defaultFormat: 'plain',
    timeoutSeconds: GEMINI_ASK_COMMAND_TIMEOUT_SECONDS,
    args: [
        { name: 'prompt', required: true, positional: true, help: 'Prompt to send' },
        { name: 'timeout', required: false, help: 'Max seconds to wait (default: OPENCLI_GEMINI_ASK_TIMEOUT or 60)' },
        { name: 'new', required: false, help: 'Start a new chat first (true/false, default: false)', default: 'false' },
    ],
    columns: ['response'],
    func: async (page, kwargs) => {
        const prompt = kwargs.prompt;
        const timeout = parseGeminiAskTimeout(kwargs.timeout, DEFAULT_GEMINI_ASK_TIMEOUT_SECONDS);
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
