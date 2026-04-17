import { cli, Strategy } from '@jackwener/opencli/registry';
import { GEMINI_DOMAIN, clickGeminiConversationByTitle, exportGeminiDeepResearchReport, getLatestGeminiAssistantResponse, getGeminiPageState, parseGeminiConversationUrl, parseGeminiTitleMatchMode, readGeminiSnapshot, resolveGeminiConversationForQuery, waitForGeminiTranscript, getGeminiConversationList, } from './utils.js';
const DEEP_RESEARCH_WAITING_MESSAGE = 'Deep Research is still running. Please wait and retry later.';
const DEEP_RESEARCH_NO_DOCS_MESSAGE = 'No Docs URL found. Please check Share & Export -> Export to Docs in Gemini UI.';
const DEEP_RESEARCH_PENDING_MESSAGE = 'Deep Research may still be running or preparing export. Please wait and retry later.';
function isDeepResearchInProgress(text) {
    return /\bresearching(?:\s+websites?)?\b|research in progress|working on your research|generating research plan|gathering sources|creating report|planning research|正在研究|研究中|调研中|生成研究计划|搜集资料|请稍候|稍候|请等待/i.test(text);
}
function isDeepResearchCompleted(text) {
    return /\bcompleted\b|research complete|completed research|report completed|已完成|研究完成|完成了研究|报告已完成/i.test(text);
}
async function resolveDeepResearchExportResponse(page, timeoutSeconds) {
    const exported = await exportGeminiDeepResearchReport(page, timeoutSeconds);
    if (exported.url)
        return exported.url;
    const snapshot = await readGeminiSnapshot(page).catch(() => null);
    if (snapshot?.isGenerating)
        return DEEP_RESEARCH_WAITING_MESSAGE;
    const latest = await getLatestGeminiAssistantResponse(page).catch(() => '');
    const turnTail = Array.isArray(snapshot?.turns)
        ? snapshot.turns.slice(-6).map((turn) => String(turn?.Text ?? '')).join('\n')
        : '';
    const transcriptTail = Array.isArray(snapshot?.transcriptLines)
        ? snapshot.transcriptLines.slice(-30).join('\n')
        : '';
    const statusText = [latest, turnTail, transcriptTail]
        .map((value) => String(value ?? '').trim())
        .filter(Boolean)
        .join('\n');
    if (statusText && isDeepResearchInProgress(statusText) && !isDeepResearchCompleted(statusText)) {
        return DEEP_RESEARCH_WAITING_MESSAGE;
    }
    if (statusText && isDeepResearchCompleted(statusText)) {
        return DEEP_RESEARCH_NO_DOCS_MESSAGE;
    }
    return DEEP_RESEARCH_PENDING_MESSAGE;
}
export const deepResearchResultCommand = cli({
    site: 'gemini',
    name: 'deep-research-result',
    description: 'Export Deep Research report URL from a Gemini conversation',
    domain: GEMINI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    defaultFormat: 'plain',
    args: [
        { name: 'query', positional: true, required: false, help: 'Conversation title or URL (optional; defaults to latest conversation)' },
        { name: 'match', required: false, default: 'contains', choices: ['contains', 'exact'], help: 'Match mode' },
        { name: 'timeout', type: 'int', required: false, default: 120, help: 'Max seconds to wait for Docs export (default: 120)' },
    ],
    columns: ['response'],
    func: async (page, kwargs) => {
        const query = String(kwargs.query ?? '').trim();
        const matchMode = parseGeminiTitleMatchMode(kwargs.match);
        const timeoutRaw = Number.parseInt(String(kwargs.timeout ?? ''), 10);
        const timeoutSeconds = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 120;
        if (!matchMode) {
            return [{ response: 'Invalid match mode. Use contains or exact.' }];
        }
        const state = await getGeminiPageState(page);
        if (state.isSignedIn === false) {
            return [{ response: 'Not signed in to Gemini.' }];
        }
        const conversationUrl = parseGeminiConversationUrl(query);
        if (conversationUrl) {
            await page.goto(conversationUrl, { waitUntil: 'load', settleMs: 2500 });
            await page.wait(1);
            await waitForGeminiTranscript(page);
            return [{ response: await resolveDeepResearchExportResponse(page, timeoutSeconds) }];
        }
        const conversations = await getGeminiConversationList(page);
        const picked = resolveGeminiConversationForQuery(conversations, query, matchMode);
        if (picked?.Url) {
            await page.goto(picked.Url, { waitUntil: 'load', settleMs: 2500 });
            await page.wait(1);
            await waitForGeminiTranscript(page);
        }
        else if (query) {
            if (matchMode === 'exact') {
                return [{ response: `No conversation matched: ${query}` }];
            }
            const clicked = await clickGeminiConversationByTitle(page, query);
            if (!clicked) {
                return [{ response: `No conversation matched: ${query}` }];
            }
            await waitForGeminiTranscript(page);
        }
        return [{ response: await resolveDeepResearchExportResponse(page, timeoutSeconds) }];
    },
});
