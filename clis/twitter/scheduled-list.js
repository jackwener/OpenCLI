import { CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { openScheduledQueue } from './scheduled-utils.js';

export function buildScheduledListScript() {
    return `(() => {
        const items = Array.from(document.querySelectorAll('[data-testid="unsentTweet"]'));
        return items.map((item, index) => {
            const text = (item.querySelector('[data-testid="tweetText"]')?.textContent || '').replace(/\\s+/g, ' ').trim();
            const fullText = (item.textContent || '').replace(/\\s+/g, ' ').trim();
            let scheduledFor = fullText;
            if (text && scheduledFor.endsWith(text)) scheduledFor = scheduledFor.slice(0, -text.length);
            scheduledFor = scheduledFor.replace(/^\\s*Will send on\\s*/i, '').trim();
            return {
                index: index + 1,
                scheduledFor,
                text,
            };
        });
    })()`;
}

cli({
    site: 'twitter',
    name: 'scheduled-list',
    access: 'read',
    description: 'List X posts currently scheduled in the web composer',
    domain: 'x.com',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['index', 'scheduledFor', 'text'],
    func: async (page) => {
        if (!page) throw new CommandExecutionError('Browser session required for twitter scheduled-list');
        const opened = await openScheduledQueue(page);
        if (!opened?.ok) throw new CommandExecutionError(opened?.message ?? 'Could not open scheduled posts queue');
        return page.evaluate(buildScheduledListScript());
    }
});

export const __test__ = {
    buildScheduledListScript,
};
