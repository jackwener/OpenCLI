import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    YUANBAO_DOMAIN,
    YUANBAO_URL,
    getYuanbaoMessageBubbles,
    parseYuanbaoSessionId,
    hasLoginGate,
    authRequired,
} from './shared.js';
import { convertYuanbaoHtmlToMarkdown } from './ask.js';

cli({
    site: 'yuanbao',
    name: 'detail',
    access: 'read',
    description: 'Open a Yuanbao conversation by ID and read its messages',
    domain: YUANBAO_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        {
            name: 'id',
            positional: true,
            required: true,
            help: 'Full https://yuanbao.tencent.com/chat/<agentId>/<convId> URL or "<agentId>/<convId>" pair (a UUID alone is not enough — Yuanbao requires the agent slug)',
        },
    ],
    columns: ['Role', 'Text'],
    func: async (page, kwargs) => {
        const { agentId, convId } = parseYuanbaoSessionId(kwargs.id);
        await page.goto(`${YUANBAO_URL}chat/${agentId}/${convId}`, { waitUntil: 'load', settleMs: 2500 });
        await page.wait(2);
        if (await hasLoginGate(page)) {
            throw authRequired('Yuanbao opened a login gate when navigating to the conversation.');
        }

        // Poll up to ~20s for the transcript to render. The page shell loads
        // before history is fetched, so a fixed wait races the empty render.
        let bubbles = [];
        const POLL_DEADLINE_MS = 20_000;
        const POLL_INTERVAL_S = 1;
        const startedAt = Date.now();
        while (Date.now() - startedAt < POLL_DEADLINE_MS) {
            bubbles = await getYuanbaoMessageBubbles(page);
            if (bubbles.length > 0) break;
            await page.wait(POLL_INTERVAL_S);
        }

        if (!bubbles.length) {
            throw new EmptyResultError(
                'yuanbao detail',
                `No visible messages found for conversation ${agentId}/${convId}. Verify the IDs are correct and that the session belongs to the current login.`,
            );
        }
        return bubbles.map((b) => ({
            Role: b.role,
            Text: b.role === 'Assistant' && b.html
                ? (convertYuanbaoHtmlToMarkdown(b.html).trim() || b.text)
                : b.text,
        }));
    },
});
