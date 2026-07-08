import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    GROK_DOMAIN,
    bubbleHtmlToMarkdown,
    ensureOnGrok,
    getMessageBubbles,
    normalizeBooleanFlag,
} from './utils.js';

cli({
    site: 'grok',
    name: 'read',
    access: 'read',
    description: 'Read messages in the current Grok conversation',
    domain: GROK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'markdown', type: 'boolean', default: false, help: 'Emit assistant replies as markdown' },
    ],
    columns: ['Role', 'Text'],
    func: async (page, kwargs) => {
        const wantMarkdown = normalizeBooleanFlag(kwargs.markdown, false);
        await ensureOnGrok(page);
        await page.wait(2);
        const bubbles = await getMessageBubbles(page);
        if (!bubbles.length) {
            return [{ Role: 'system', Text: 'No visible messages in the current conversation.' }];
        }
        return bubbles.map((b) => ({
            Role: b.role,
            Text: wantMarkdown && b.role === 'Assistant' && b.html
                ? (bubbleHtmlToMarkdown(b.html) || b.text)
                : b.text,
        }));
    },
});
