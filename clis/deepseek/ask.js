import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    DEEPSEEK_DOMAIN, DEEPSEEK_URL, ensureOnDeepSeek, selectModel, enableFeature,
    sendMessage, getBubbleCount, waitForResponse, parseBoolFlag, withRetry,
} from './utils.js';

export const askCommand = cli({
    site: 'deepseek',
    name: 'ask',
    description: 'Send a prompt to DeepSeek and get the response',
    domain: DEEPSEEK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    timeoutSeconds: 180,
    args: [
        { name: 'prompt', positional: true, required: true, help: 'Prompt to send' },
        { name: 'timeout', type: 'int', default: 120, help: 'Max seconds to wait for response' },
        { name: 'new', type: 'boolean', default: false, help: 'Start a new chat before sending' },
        { name: 'model', default: 'instant', choices: ['instant', 'expert'], help: 'Model to use: instant or expert' },
        { name: 'think', type: 'boolean', default: false, help: 'Enable DeepThink mode' },
        { name: 'search', type: 'boolean', default: false, help: 'Enable web search' },
    ],
    columns: ['response'],

    func: async (page, kwargs) => {
        const prompt = kwargs.prompt;
        const timeoutMs = (kwargs.timeout || 120) * 1000;

        if (parseBoolFlag(kwargs.new)) {
            await page.goto(DEEPSEEK_URL);
            await page.wait(3);
        } else {
            await ensureOnDeepSeek(page);
        }

        await page.wait(2);

        if (kwargs.model && kwargs.model !== 'instant') {
            await withRetry(() => selectModel(page, kwargs.model));
            await page.wait(0.5);
        }

        if (parseBoolFlag(kwargs.think)) {
            await withRetry(() => enableFeature(page, 'DeepThink'));
            await page.wait(0.5);
        }
        if (parseBoolFlag(kwargs.search)) {
            await withRetry(() => enableFeature(page, 'Search'));
            await page.wait(0.5);
        }

        const baseline = await withRetry(() => getBubbleCount(page));
        const sendResult = await withRetry(() => sendMessage(page, prompt));
        if (!sendResult?.ok) {
            return [{ response: `[SEND FAILED] ${sendResult?.reason || 'unknown error'}` }];
        }

        const response = await waitForResponse(page, baseline, prompt, timeoutMs);
        if (!response) {
            return [{ response: `[NO RESPONSE] No reply within ${kwargs.timeout}s.` }];
        }

        return [{ response }];
    },
});
