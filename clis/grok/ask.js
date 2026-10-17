import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';
import {
    authRequired,
    ensureOnGrok,
    getCurrentSessionId,
    getMessageBubbles,
    isLoggedIn,
    normalizeBooleanFlag,
    sendMessage,
    startNewChat,
    waitForAnswer,
} from './utils.js';

const SESSION_HINT = 'Likely login/auth/challenge/session issue in the existing grok.com browser session.';

async function getBaselineLastAssistantId(page) {
    const bubbles = await getMessageBubbles(page);
    for (let i = bubbles.length - 1; i >= 0; i -= 1) {
        if (bubbles[i].role === 'Assistant') return bubbles[i].id;
    }
    return '';
}

export const askCommand = cli({
    site: 'grok',
    name: 'ask',
    access: 'write',
    description: 'Send a message to Grok and get response',
    domain: 'grok.com',
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    args: [
        { name: 'prompt', positional: true, type: 'string', required: true, help: 'Prompt to send to Grok' },
        { name: 'timeout', type: 'int', default: 120, help: 'Max seconds to wait for response (default: 120)' },
        { name: 'new', type: 'boolean', default: false, help: 'Start a new chat before sending (default: false)' },
    ],
    columns: ['response'],
    func: async (page, kwargs) => {
        const prompt = kwargs.prompt;
        const timeoutSeconds = kwargs.timeout || 120;
        const newChat = normalizeBooleanFlag(kwargs.new);

        if (newChat) {
            await startNewChat(page);
        } else {
            await ensureOnGrok(page);
        }

        if (!(await isLoggedIn(page))) {
            throw authRequired();
        }

        const baselineLastAssistantId = await getBaselineLastAssistantId(page);
        const sendResult = await sendMessage(page, prompt);
        if (!sendResult || !sendResult.ok) {
            const reason = sendResult?.reason || 'Unable to send the prompt to Grok.';
            const detail = sendResult?.detail ? ` ${sendResult.detail}` : '';
            throw new CommandExecutionError(`${reason}${detail}`, SESSION_HINT);
        }

        const result = await waitForAnswer(page, prompt, timeoutSeconds, baselineLastAssistantId);
        if (result.status === 'ok') {
            return [{ response: (await rereadFinalAnswer(page, result.assistant)) || result.assistant.text }];
        }
        // Partial: streaming was seen but did not stabilize; keep the best-effort
        // text rather than throwing — the caller asked us to wait, not to discard.
        if (result.status === 'partial' && result.assistant) {
            return [{ response: result.assistant.text }];
        }
        throw new TimeoutError('grok ask response', timeoutSeconds);
    },
});

// Grok reveals a streamed answer frame by frame; a background tab gets few frames, so the text read
// when generation ends can be cut mid-sentence. A fresh load of the conversation renders it whole.
async function rereadFinalAnswer(page, assistant) {
    // Positional IDs can identify a different turn after hydration.
    if (!assistant?.id || assistant.id.startsWith('pos-')) return '';
    try {
        const sessionId = await getCurrentSessionId(page);
        if (!sessionId) return '';
        await page.goto(`https://grok.com/c/${sessionId}`);
        let previousText = '';
        let stableCount = 0;
        for (let i = 0; i < 20; i += 1) {
            await page.wait(1);
            const target = (await getMessageBubbles(page)).find(
                (bubble) => bubble.role === 'Assistant' && bubble.id === assistant.id,
            );
            const text = target?.text || '';
            // Never replace an observed answer with an older or shorter render.
            if (!text || text.length < assistant.text.length) {
                previousText = '';
                stableCount = 0;
                continue;
            }
            stableCount = text === previousText ? stableCount + 1 : 0;
            previousText = text;
            if (stableCount >= 2) return text;
        }
    } catch {
        // Reload is best-effort: the completed answer remains usable.
    }
    return '';
}

export const __test__ = {
    getBaselineLastAssistantId,
    rereadFinalAnswer,
};
