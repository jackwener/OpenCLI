import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import {
    CHATGPT_DOMAIN,
    CHATGPT_URL,
    ensureChatGPTComposer,
    ensureOnChatGPT,
    normalizeBooleanFlag,
    openChatGPTConversation,
    requireNonEmptyPrompt,
    sendChatGPTMessage,
    startNewChat,
    navigateToProject,
} from './utils.js';

export const sendCommand = cli({
    site: 'chatgpt',
    name: 'send',
    access: 'write',
    description: 'Send a prompt to ChatGPT web without waiting for the response',
    domain: CHATGPT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'prompt', positional: true, required: true, help: 'Prompt to send' },
        { name: 'new', type: 'boolean', default: false, help: 'Start a new chat before sending' },
        { name: 'conversation', valueRequired: true, help: 'Continue an existing ChatGPT conversation ID or /c/<id> URL' },
        { name: 'project', valueRequired: true, help: 'Start a new chat inside a ChatGPT project ID or /g/g-p-<id> URL' },
    ],
    columns: ['Status', 'InjectedText'],
    func: async (page, kwargs) => {
        const prompt = requireNonEmptyPrompt(kwargs.prompt, 'chatgpt send');

        if (normalizeBooleanFlag(kwargs.new) && kwargs.conversation) {
            throw new ArgumentError(
                'chatgpt send cannot use --new and --conversation together',
                'Choose either a new chat or an existing conversation.',
            );
        }
        if (kwargs.project && kwargs.conversation) {
            throw new ArgumentError(
                'chatgpt send cannot use --project and --conversation together',
                'Choose either a project new chat or an existing conversation.',
            );
        }

        if (kwargs.conversation) {
            await openChatGPTConversation(page, kwargs.conversation);
        } else if (kwargs.project) {
            await navigateToProject(page, kwargs.project);
        } else if (normalizeBooleanFlag(kwargs.new)) {
            await startNewChat(page);
        } else {
            await ensureOnChatGPT(page);
        }
        // startNewChat / ensureOnChatGPT now wait for the composer selector
        // after navigating, so the previous standalone 2 s settle is redundant.
        await ensureChatGPTComposer(page, 'ChatGPT send requires a logged-in ChatGPT session with a visible composer.');

        const sent = await sendChatGPTMessage(page, prompt);
        if (!sent) {
            throw new CommandExecutionError('Failed to send message to ChatGPT', `Open ${CHATGPT_URL} and verify the composer is ready.`);
        }
        return [{ Status: 'Success', InjectedText: prompt }];
    },
});
