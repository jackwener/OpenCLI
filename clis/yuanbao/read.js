import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    YUANBAO_DOMAIN,
    ensureYuanbaoPage,
    getYuanbaoMessageBubbles,
} from './shared.js';
import { convertYuanbaoHtmlToMarkdown } from './ask.js';

cli({
    site: 'yuanbao',
    name: 'read',
    access: 'read',
    description: 'Read messages in the current Yuanbao conversation',
    domain: YUANBAO_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    browserSession: { reuse: 'site' },
    navigateBefore: false,
    args: [],
    columns: ['Role', 'Text'],
    func: async (page) => {
        await ensureYuanbaoPage(page);
        await page.wait(1.5);
        const bubbles = await getYuanbaoMessageBubbles(page);
        if (!bubbles.length) {
            return [{ Role: 'system', Text: 'No visible messages in the current Yuanbao conversation.' }];
        }
        return bubbles.map((b) => ({
            Role: b.role,
            // Assistant turns render markdown HTML; convert to markdown so the
            // text column carries usable structure (lists, code, tables) rather
            // than collapsed innerText.
            Text: b.role === 'Assistant' && b.html
                ? (convertYuanbaoHtmlToMarkdown(b.html).trim() || b.text)
                : b.text,
        }));
    },
});
