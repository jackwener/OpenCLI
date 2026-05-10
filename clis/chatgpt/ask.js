import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import {
    CHATGPT_DOMAIN,
    CHATGPT_URL,
    ensureChatGPTComposer,
    ensureOnChatGPT,
    getBubbleCount,
    normalizeBooleanFlag,
    requireNonEmptyPrompt,
    requirePositiveInt,
    sendChatGPTMessage,
    startNewChat,
    waitForChatGPTResponse,
} from './utils.js';

export const askCommand = cli({
    site: 'chatgpt',
    name: 'ask',
    access: 'write',
    description: 'Send a prompt to ChatGPT web and wait for the response',
    domain: CHATGPT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'prompt', positional: true, required: true, help: 'Prompt to send' },
        { name: 'timeout', type: 'int', default: 120, help: 'Max seconds to wait for response' },
        { name: 'new', type: 'boolean', default: false, help: 'Start a new chat before sending' },
    ],
    columns: ['response'],
    func: async (page, kwargs) => {
        const prompt = requireNonEmptyPrompt(kwargs.prompt, 'chatgpt ask');
        const timeout = requirePositiveInt(
            Number(kwargs.timeout ?? 120),
            'chatgpt ask --timeout',
            'Example: opencli chatgpt ask "hello" --timeout 120',
        );

        if (normalizeBooleanFlag(kwargs.new)) {
            await startNewChat(page);
        } else {
            await ensureOnChatGPT(page);
        }
        // startNewChat / ensureOnChatGPT now wait for the composer selector
        // after navigating, so the previous standalone 2 s settle is redundant.
        await ensureChatGPTComposer(page, 'ChatGPT ask requires a logged-in ChatGPT session with a visible composer.');

        const baseline = await getBubbleCount(page);
        const sent = await sendChatGPTMessage(page, prompt);
        if (!sent) {
            throw new CommandExecutionError('Failed to send message to ChatGPT', `Open ${CHATGPT_URL} and verify the composer is ready.`);
        }

        return [{ response: await waitForChatGPTResponse(page, baseline, prompt, timeout) }];
    },
});
