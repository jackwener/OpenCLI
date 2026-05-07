import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    QIANWEN_DOMAIN,
    bubbleHtmlToMarkdown,
    dismissLoginModal,
    getMessageBubbles,
    normalizeBooleanFlag,
    parseQianwenSessionId,
} from './utils.js';

cli({
    site: 'qwen',
    name: 'detail',
    access: 'read',
    description: 'Open a Qianwen conversation by ID and read its messages',
    domain: QIANWEN_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    browserSession: { reuse: 'site' },
    args: [
        { name: 'id', positional: true, required: true, help: 'Session ID (32-char hex) or full https://www.qianwen.com/chat/<id> URL' },
        { name: 'markdown', type: 'boolean', default: false, help: 'Emit assistant replies as markdown' },
    ],
    columns: ['Role', 'Text'],
    func: async (page, kwargs) => {
        const sessionId = parseQianwenSessionId(kwargs.id);
        const wantMarkdown = normalizeBooleanFlag(kwargs.markdown, false);

        await page.goto(`https://www.qianwen.com/chat/${sessionId}`);
        await page.wait(2);
        await dismissLoginModal(page);

        // Poll for the conversation transcript to load. Qianwen renders the chat
        // page shell before fetching message history, so a fixed wait can race the
        // initial empty render. Cap at ~20s to surface real "no data" cases without
        // hanging on broken IDs.
        let bubbles = [];
        const POLL_DEADLINE_MS = 20_000;
        const POLL_INTERVAL_S = 1;
        const startedAt = Date.now();
        while (Date.now() - startedAt < POLL_DEADLINE_MS) {
            bubbles = await getMessageBubbles(page);
            if (bubbles.length > 0) break;
            await page.wait(POLL_INTERVAL_S);
        }

        if (!bubbles.length) {
            throw new EmptyResultError(
                'qwen detail',
                `No visible messages found for conversation ${sessionId}. Verify the ID is correct and that the session belongs to the current device's b-user-id (or that you are logged in for cross-device sync).`,
            );
        }
        return bubbles.map((b) => ({
            Role: b.role,
            Text: wantMarkdown && b.role === 'Assistant' && b.html
                ? (bubbleHtmlToMarkdown(b.html) || b.text)
                : b.text,
        }));
    },
});
