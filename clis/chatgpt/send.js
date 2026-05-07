import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import {
    CHATGPT_DOMAIN,
    CHATGPT_URL,
    ensureChatGPTComposer,
    ensureOnChatGPT,
    normalizeBooleanFlag,
    requireNonEmptyPrompt,
    sendChatGPTMessage,
    startNewChat,
} from './utils.js';

export const sendCommand = cli({
    site: 'chatgpt',
    name: 'send',
    access: 'write',
    description: 'Send a prompt to ChatGPT web without waiting for the response',
    domain: CHATGPT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    browserSession: { reuse: 'site' },
    navigateBefore: false,
    args: [
        { name: 'prompt', positional: true, required: true, help: 'Prompt to send' },
        { name: 'new', type: 'boolean', default: false, help: 'Start a new chat before sending' },
    ],
    columns: ['Status', 'InjectedText'],
    func: async (page, kwargs) => {
        const prompt = requireNonEmptyPrompt(kwargs.prompt, 'chatgpt send');

        if (normalizeBooleanFlag(kwargs.new)) {
            await startNewChat(page);
        } else {
            await ensureOnChatGPT(page);
        }
        await page.wait(2);
        await ensureChatGPTComposer(page, 'ChatGPT send requires a logged-in ChatGPT session with a visible composer.');

        const sent = await sendChatGPTMessage(page, prompt);
        if (!sent) {
            throw new CommandExecutionError('Failed to send message to ChatGPT', `Open ${CHATGPT_URL} and verify the composer is ready.`);
        }
        return [{ Status: 'Success', InjectedText: prompt }];
    },
});
