import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import {
    CHATGPT_DOMAIN,
    CHATGPT_URL,
    currentChatGPTUrl,
    ensureChatGPTComposer,
    ensureOnChatGPT,
    getBubbleCount,
    normalizeBooleanFlag,
    requireNonEmptyPrompt,
    requirePositiveInt,
    parseChatGPTConversationId,
    sendChatGPTMessage,
    selectChatGPTTool,
    startNewChat,
    waitForChatGPTResponse,
} from './utils.js';

async function waitForConversationUrl(page, timeoutSeconds = 30) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutSeconds * 1000) {
        const conversationUrl = await currentChatGPTUrl(page);
        try {
            const conversationId = parseChatGPTConversationId(conversationUrl);
            return { conversationId, conversationUrl };
        } catch {
            await page.wait(1);
        }
    }
    throw new CommandExecutionError('ChatGPT did not create a conversation URL after sending the message.');
}

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
        { name: 'wait', type: 'boolean', default: true, help: 'Wait for the assistant response after sending' },
        { name: 'deep-research', type: 'boolean', default: false, help: 'Enable ChatGPT 深度研究 (Deep Research)' },
        { name: 'web-search', type: 'boolean', default: false, help: 'Enable ChatGPT 网页搜索 (Web Search)' },
    ],
    columns: ['conversationId', 'conversationUrl', 'tool', 'response'],
    func: async (page, kwargs) => {
        const prompt = requireNonEmptyPrompt(kwargs.prompt, 'chatgpt ask');
        const timeout = requirePositiveInt(
            Number(kwargs.timeout ?? 120),
            'chatgpt ask --timeout',
            'Example: opencli chatgpt ask "hello" --timeout 120',
        );
        const useDeepResearch = normalizeBooleanFlag(kwargs['deep-research'], false);
        const useWebSearch = normalizeBooleanFlag(kwargs['web-search'], false);
        const shouldWait = normalizeBooleanFlag(kwargs.wait, true);
        if (useDeepResearch && useWebSearch) {
            throw new ArgumentError(
                'chatgpt ask cannot enable both --deep-research and --web-search',
                'Choose one ChatGPT composer tool for this message.',
            );
        }
        const tool = useDeepResearch ? 'deep-research' : (useWebSearch ? 'web-search' : null);

        if (normalizeBooleanFlag(kwargs.new)) {
            await startNewChat(page);
        } else {
            await ensureOnChatGPT(page);
        }
        // startNewChat / ensureOnChatGPT now wait for the composer selector
        // after navigating, so the previous standalone 2 s settle is redundant.
        await ensureChatGPTComposer(page, 'ChatGPT ask requires a logged-in ChatGPT session with a visible composer.');
        const selectedTool = tool ? await selectChatGPTTool(page, tool) : null;

        const baseline = await getBubbleCount(page);
        const sent = await sendChatGPTMessage(page, prompt);
        if (!sent) {
            throw new CommandExecutionError('Failed to send message to ChatGPT', `Open ${CHATGPT_URL} and verify the composer is ready.`);
        }

        const { conversationId, conversationUrl } = await waitForConversationUrl(page);
        if (!shouldWait) {
            return [{ conversationId, conversationUrl, tool: selectedTool?.Tool ?? '', response: '' }];
        }
        const response = await waitForChatGPTResponse(page, baseline, prompt, timeout);
        return [{ conversationId, conversationUrl, tool: selectedTool?.Tool ?? '', response }];
    },
});
