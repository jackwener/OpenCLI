import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    CHATGPT_DOMAIN,
    CHATGPT_URL,
    currentChatGPTUrl,
    ensureChatGPTLogin,
    getChatGPTDeepResearchResult,
    normalizeBooleanFlag,
    parseChatGPTConversationId,
    requireNonNegativeInt,
    requirePositiveInt,
    waitForChatGPTDeepResearchResult,
} from './utils.js';

function hasDeepResearchProgress(result) {
    return !!result
        && result.status !== 'completed'
        && result.progress
        && typeof result.progress === 'object'
        && !Array.isArray(result.progress)
        && Object.keys(result.progress).length > 0;
}

export const deepResearchResultCommand = cli({
    site: 'chatgpt',
    name: 'deep-research-result',
    access: 'read',
    description: 'Read a completed ChatGPT Deep Research report from the conversation payload',
    domain: CHATGPT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'Conversation ID or full /c/<id> URL' },
        { name: 'wait', type: 'boolean', default: false, help: 'Wait until Deep Research completes or becomes extractable' },
        { name: 'timeout', type: 'int', default: 120, help: 'Max seconds to wait when --wait is true' },
        { name: 'stable', type: 'int', default: 6, help: 'Seconds the report text must remain unchanged when --wait is true' },
    ],
    columns: [
        'conversationId',
        'status',
        'report',
        'sources',
        'progress',
        'asyncTaskConversationId',
        'widgetSessionId',
        'asyncStatus',
        'venusMessageType',
        'venusStatus',
        'waitingForUserUntil',
        'planTitle',
        'planId',
        'url',
        'method',
        'diagnostics',
    ],
    func: async (page, kwargs) => {
        const id = parseChatGPTConversationId(kwargs.id);
        const shouldWait = normalizeBooleanFlag(kwargs.wait, false);
        const timeout = requirePositiveInt(
            Number(kwargs.timeout ?? 120),
            'chatgpt deep-research-result --timeout',
            'Example: opencli chatgpt deep-research-result <id> --wait true --timeout 600',
        );
        const stableSeconds = requireNonNegativeInt(
            Number(kwargs.stable ?? 6),
            'chatgpt deep-research-result --stable',
            'Example: opencli chatgpt deep-research-result <id> --wait true --stable 6',
        );
        const targetUrl = `${CHATGPT_URL}/c/${id}`;
        await page.readNetworkCapture?.().catch(() => []);
        const currentUrl = await currentChatGPTUrl(page).catch(() => '');
        if (currentUrl.startsWith(targetUrl)) {
            await page.goto(`${CHATGPT_URL}/?opencli_dr_result=${Date.now()}`, { waitUntil: 'none' });
            await page.wait(1);
        }
        await page.startNetworkCapture?.('/backend-api/conversation/').catch(() => false);
        await page.goto(targetUrl, { waitUntil: 'none' });
        await page.sleep(3);
        await ensureChatGPTLogin(page, 'ChatGPT deep-research-result requires a logged-in ChatGPT session.');

        const result = shouldWait
            ? await waitForChatGPTDeepResearchResult(page, { conversationId: id, timeoutSeconds: timeout, stableSeconds })
            : await getChatGPTDeepResearchResult(page, { conversationId: id, useBridgeProbes: true });

        if (result.status !== 'completed' && !hasDeepResearchProgress(result)) {
            throw new EmptyResultError(
                'chatgpt deep-research-result',
                `No completed Deep Research report was found for conversation ${id}.`,
            );
        }

        if (result.status === 'completed' && !result.report) {
            throw new EmptyResultError(
                'chatgpt deep-research-result',
                `No completed Deep Research report was found for conversation ${id}.`,
            );
        }

        return [{
            conversationId: id,
            status: result.status,
            report: result.report || '',
            sources: result.sources || [],
            progress: result.progress || {},
            asyncTaskConversationId: result.asyncTaskConversationId || '',
            widgetSessionId: result.widgetSessionId || '',
            asyncStatus: result.asyncStatus ?? '',
            venusMessageType: result.venusMessageType || '',
            venusStatus: result.venusStatus || '',
            waitingForUserUntil: result.waitingForUserUntil || '',
            planTitle: result.planTitle || '',
            planId: result.planId || '',
            url: result.url || targetUrl,
            method: result.method || '',
            diagnostics: result.diagnostics || {},
        }];
    },
});
