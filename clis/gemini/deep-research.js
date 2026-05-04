import { cli, Strategy } from '@jackwener/opencli/registry';
import { GEMINI_DEEP_RESEARCH_DEFAULT_CONFIRM_LABELS, GEMINI_DEEP_RESEARCH_DEFAULT_TOOL_LABELS, GEMINI_APP_URL, GEMINI_DOMAIN, getCurrentGeminiUrl, getLatestGeminiAssistantResponse, parseGeminiPositiveInt, readGeminiSnapshot, resolveGeminiLabels, selectGeminiTool, sendGeminiMessage, startNewGeminiChat, waitForGeminiSubmission, waitForGeminiConfirmButton, } from './utils.js';
function isGeminiRootAppUrl(url) {
    try {
        const parsed = new URL(url);
        return parsed.origin + parsed.pathname.replace(/\/+$/, '') === GEMINI_APP_URL;
    }
    catch {
        return false;
    }
}
function parseDeepResearchProgress(text) {
    const isResearching = /\bresearching(?:\s+websites?)?\b|research in progress|working on your research|正在研究|研究中/i.test(text);
    const waitingForStart = /\bstart(?:\s+deep)?\s+research\b|begin\s+research|generate(?:\s+deep)?\s+research\s+plan|开始研究|开始深度研究|开始调研|生成研究计划|生成调研计划|try again without deep research/i.test(text);
    return { isResearching, waitingForStart };
}
export const deepResearchCommand = cli({
    site: 'gemini',
    name: 'deep-research',
    access: 'write',
    description: 'Start a Gemini Deep Research run and confirm it',
    domain: GEMINI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    defaultFormat: 'plain',
    timeoutSeconds: 180,
    args: [
        { name: 'prompt', positional: true, required: true, help: 'Prompt to send' },
        { name: 'timeout', type: 'int', required: false, help: 'Max seconds to wait for confirm (default: 30)', default: 30 },
        { name: 'tool', required: false, help: 'Override tool label (default: Deep Research)' },
        { name: 'confirm', required: false, help: 'Override confirm button label (default: Start research)' },
    ],
    columns: ['status', 'url'],
    func: async (page, kwargs) => {
        const prompt = kwargs.prompt;
        const timeout = parseGeminiPositiveInt(kwargs.timeout, 30);
        const submitTimeout = Math.min(Math.max(timeout, 6), 20);
        await startNewGeminiChat(page);
        const toolLabels = resolveGeminiLabels(kwargs.tool, GEMINI_DEEP_RESEARCH_DEFAULT_TOOL_LABELS);
        const confirmLabels = resolveGeminiLabels(kwargs.confirm, GEMINI_DEEP_RESEARCH_DEFAULT_CONFIRM_LABELS);
        const toolMatched = await selectGeminiTool(page, toolLabels);
        if (!toolMatched) {
            const url = await getCurrentGeminiUrl(page);
            return [{ status: 'tool-not-found', url }];
        }
        let baseline = await readGeminiSnapshot(page);
        await sendGeminiMessage(page, prompt);
        let submitted = await waitForGeminiSubmission(page, baseline, submitTimeout);
        if (!submitted) {
            // Retry once when submit did not stick (e.g. composer swallowed Enter/click in this UI state).
            await selectGeminiTool(page, toolLabels);
            baseline = await readGeminiSnapshot(page);
            await sendGeminiMessage(page, prompt);
            submitted = await waitForGeminiSubmission(page, baseline, submitTimeout);
        }
        if (!submitted) {
            const url = await getCurrentGeminiUrl(page);
            return [{ status: 'submit-not-found', url }];
        }
        const confirmed = await waitForGeminiConfirmButton(page, confirmLabels, timeout);
        let url = await getCurrentGeminiUrl(page);
        if (confirmed && !isGeminiRootAppUrl(url)) {
            return [{ status: 'started', url }];
        }
        // false-positive confirm click can happen on generic buttons while still at /app root.
        {
            // Retry once when we are still at the root app URL, which usually means submit did not stick.
            if (isGeminiRootAppUrl(url)) {
                await selectGeminiTool(page, toolLabels);
                // Avoid resending prompt here: it can create a duplicate conversation thread.
                const confirmedRetry = await waitForGeminiConfirmButton(page, confirmLabels, timeout);
                url = await getCurrentGeminiUrl(page);
                if (confirmedRetry && !isGeminiRootAppUrl(url)) {
                    return [{ status: 'started', url }];
                }
            }
            let response = await getLatestGeminiAssistantResponse(page);
            let { isResearching, waitingForStart } = parseDeepResearchProgress(response);
            // Some UIs render the plan card first; click confirm one more time without resending prompt.
            if (!isResearching && waitingForStart) {
                const fallbackConfirmLabels = Array.from(new Set([
                    ...confirmLabels,
                    ...GEMINI_DEEP_RESEARCH_DEFAULT_CONFIRM_LABELS,
                ]));
                const confirmedFallback = await waitForGeminiConfirmButton(page, fallbackConfirmLabels, Math.min(timeout, 8));
                if (confirmedFallback) {
                    url = await getCurrentGeminiUrl(page);
                    response = await getLatestGeminiAssistantResponse(page);
                    ({ isResearching, waitingForStart } = parseDeepResearchProgress(response));
                }
            }
            if (isResearching && !waitingForStart) {
                return [{ status: 'started', url }];
            }
            return [{ status: 'confirm-not-found', url }];
        }
    },
});
