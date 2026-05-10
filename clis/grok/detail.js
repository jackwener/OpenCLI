import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    GROK_DOMAIN,
    bubbleHtmlToMarkdown,
    getMessageBubbles,
    normalizeBooleanFlag,
    parseGrokSessionId,
} from './utils.js';

cli({
    site: 'grok',
    name: 'detail',
    access: 'read',
    description: 'Open a Grok conversation by ID and read its messages',
    domain: GROK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    siteSession: 'persistent',
    args: [
        { name: 'id', positional: true, required: true, help: 'Session ID (UUID) or full https://grok.com/c/<id> URL' },
        { name: 'markdown', type: 'boolean', default: false, help: 'Emit assistant replies as markdown' },
    ],
    columns: ['Role', 'Text'],
    func: async (page, kwargs) => {
        const sessionId = parseGrokSessionId(kwargs.id);
        const wantMarkdown = normalizeBooleanFlag(kwargs.markdown, false);

        await page.goto(`https://grok.com/c/${sessionId}`);
        await page.wait(2);

        // Poll for the conversation transcript to load. Grok renders the chat
        // page shell before fetching message history, so a fixed wait can race
        // the initial empty render. Cap at ~20s so genuinely missing IDs surface
        // an EmptyResultError rather than hanging.
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
                'grok detail',
                `No visible messages found for conversation ${sessionId}. Verify the ID is correct and that the conversation belongs to the signed-in account.`,
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
