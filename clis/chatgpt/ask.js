import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import {
    CHATGPT_DOMAIN,
    CHATGPT_URL,
    currentChatGPTUrl,
    ensureChatGPTComposer,
    ensureOnChatGPT,
    getChatGPTResponsePairCounts,
    getVisibleMessages,
    normalizeBooleanFlag,
    openChatGPTConversation,
    requireNonEmptyPrompt,
    requirePositiveInt,
    parseChatGPTConversationId,
    resolveWebConversationId,
    sendChatGPTMessage,
    selectChatGPTTool,
    isGenerating,
    startNewChat,
    navigateToProject,
    waitForChatGPTResponse,
} from './utils.js';

// [LOCAL PATCH 2026-09-03] 2026-09 chatgpt.com routes brand-new conversations
// to /c/WEB:<uuid> (a client-side temporary id that never appears in the
// backend API). Accept any /c/<id> route — including WEB: ids — so ask no
// longer times out waiting for the old-style conversation URL.
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
        { name: 'conversation', valueRequired: true, help: 'Continue an existing ChatGPT conversation ID or /c/<id> URL' },
        { name: 'project', valueRequired: true, help: 'Start a new chat inside a ChatGPT project ID or /g/g-p-<id> URL' },
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
        if (normalizeBooleanFlag(kwargs.new) && kwargs.conversation) {
            throw new ArgumentError(
                'chatgpt ask cannot use --new and --conversation together',
                'Choose either a new chat or an existing conversation.',
            );
        }
        if (kwargs.project && kwargs.conversation) {
            throw new ArgumentError(
                'chatgpt ask cannot use --project and --conversation together',
                'Choose either a project new chat or an existing conversation.',
            );
        }
        const tool = useDeepResearch ? 'deep-research' : (useWebSearch ? 'web-search' : null);

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
        await ensureChatGPTComposer(page, 'ChatGPT ask requires a logged-in ChatGPT session with a visible composer.');
        const selectedTool = tool ? await selectChatGPTTool(page, tool) : null;

        const settleStart = Date.now();
        while (await isGenerating(page)) {
            if (Date.now() - settleStart > timeout * 1000) {
                throw new CommandExecutionError('ChatGPT conversation is still generating; wait for it to finish before sending another message.');
            }
            await page.sleep(3);
        }

        const baselineMessages = await getVisibleMessages(page);
        const baseline = baselineMessages.length;
        const baselinePairCounts = getChatGPTResponsePairCounts(baselineMessages, prompt);
        const sent = await sendChatGPTMessage(page, prompt);
        if (!sent) {
            throw new CommandExecutionError('Failed to send message to ChatGPT', `Open ${CHATGPT_URL} and verify the composer is ready.`);
        }

        const { conversationId: rawConversationId, conversationUrl } = await waitForConversationUrl(page);
        // [LOCAL PATCH 2026-09-03] WEB:<uuid> is a frontend-only temporary id.
        // Observed behaviour (2026-09-03): after the response finishes, the
        // frontend itself replaces the URL with the real /c/<server-id>. So:
        // wait for the response, re-read the URL, and if it now parses to a
        // non-WEB id use it; only fall back to the backend-api listing when
        // the URL still carries the WEB: prefix.
        let conversationId = rawConversationId;
        if (/^WEB:/i.test(rawConversationId)) {
            if (shouldWait) {
                const response = await waitForChatGPTResponse(page, baseline, prompt, timeout, {
                    baselinePairCounts,
                    // URL may legitimately swap WEB:<uuid> -> real id mid-wait;
                    // pass null so the leave-conversation guard does not false-fire.
                    conversationUrl: null,
                });
                const postUrl = await currentChatGPTUrl(page);
                let postParsed = '';
                try { postParsed = parseChatGPTConversationId(postUrl); } catch { /* keep WEB id */ }
                if (postParsed && !/^WEB:/i.test(postParsed)) {
                    conversationId = postParsed;
                } else {
                    conversationId = await resolveWebConversationId(page) || rawConversationId;
                }
                return [{
                    conversationId,
                    conversationUrl: conversationId && !/^WEB:/i.test(conversationId)
                        ? `${CHATGPT_URL}/c/${conversationId}`
                        : conversationUrl,
                    tool: selectedTool?.Tool ?? '',
                    response,
                }];
            }
            // --no-wait: return the WEB id as-is; nothing better is available yet.
            return [{ conversationId, conversationUrl, tool: selectedTool?.Tool ?? '', response: '' }];
        }
        if (!shouldWait) {
            return [{ conversationId, conversationUrl, tool: selectedTool?.Tool ?? '', response: '' }];
        }
        const response = await waitForChatGPTResponse(page, baseline, prompt, timeout, {
            baselinePairCounts,
            conversationUrl,
        });
        return [{ conversationId, conversationUrl, tool: selectedTool?.Tool ?? '', response }];
    },
});
