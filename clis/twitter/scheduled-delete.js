import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { openScheduledQueue } from './scheduled-utils.js';

function normalizeMatch(input) {
    const match = String(input ?? '').trim();
    if (!match) {
        throw new ArgumentError('Text fragment is required to delete a scheduled post');
    }
    return match;
}

export function buildScheduledDeleteScript(match) {
    return `(async () => {
        try {
            const needle = ${JSON.stringify(match)}.toLowerCase();
            const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
            const normalize = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
            const findItems = () => Array.from(document.querySelectorAll('[data-testid="unsentTweet"]'));
            let items = findItems();
            const target = items.find((item) => normalize(item.querySelector('[data-testid="tweetText"]')?.textContent || item.textContent).toLowerCase().includes(needle));
            if (!target) {
                return { ok: false, message: 'Could not find a scheduled post matching the text fragment.' };
            }

            const edit = Array.from(document.querySelectorAll('button,[role="button"]'))
                .find((el) => visible(el) && normalize(el.textContent) === 'Edit');
            if (edit) {
                edit.click();
                await new Promise(r => setTimeout(r, 800));
            }

            items = findItems();
            const editableTarget = items.find((item) => normalize(item.querySelector('[data-testid="tweetText"]')?.textContent || item.textContent).toLowerCase().includes(needle));
            if (!editableTarget) {
                return { ok: false, message: 'Scheduled post disappeared before deletion.' };
            }

            const row = editableTarget.closest('button,[role="button"], [data-testid="cellInnerDiv"]') || editableTarget.parentElement;
            const checkbox = row?.querySelector('[role="checkbox"], input[type="checkbox"]')
                || editableTarget.parentElement?.querySelector('[role="checkbox"], input[type="checkbox"]');
            if (checkbox) {
                checkbox.click();
            } else {
                editableTarget.click();
            }
            await new Promise(r => setTimeout(r, 800));

            const deleteButton = Array.from(document.querySelectorAll('button,[role="button"]'))
                .find((el) => visible(el) && /^delete$/i.test(normalize(el.textContent)) && el.getAttribute('aria-disabled') !== 'true' && !el.disabled);
            if (!deleteButton) {
                return { ok: false, message: 'Could not find enabled Delete button after selecting scheduled post.' };
            }
            deleteButton.click();
            await new Promise(r => setTimeout(r, 800));

            const confirm = document.querySelector('[data-testid="confirmationSheetConfirm"]')
                || Array.from(document.querySelectorAll('button,[role="button"]')).find((el) => visible(el) && /^delete$/i.test(normalize(el.textContent)));
            if (!confirm) {
                return { ok: false, message: 'Delete confirmation dialog did not appear.' };
            }
            confirm.click();
            await new Promise(r => setTimeout(r, 1200));

            const stillExists = findItems().some((item) => normalize(item.querySelector('[data-testid="tweetText"]')?.textContent || item.textContent).toLowerCase().includes(needle));
            if (stillExists) {
                return { ok: false, message: 'Scheduled post still appears after delete confirmation.' };
            }
            return { ok: true, message: 'Scheduled post deleted.' };
        } catch (e) {
            return { ok: false, message: String(e) };
        }
    })()`;
}

cli({
    site: 'twitter',
    name: 'scheduled-delete',
    access: 'write',
    description: 'Delete a scheduled X post by matching a text fragment',
    domain: 'x.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'match', type: 'string', required: true, positional: true, help: 'Text fragment that uniquely identifies the scheduled post' },
    ],
    columns: ['status', 'message', 'match'],
    func: async (page, kwargs) => {
        if (!page) throw new CommandExecutionError('Browser session required for twitter scheduled-delete');
        const match = normalizeMatch(kwargs.match);
        const opened = await openScheduledQueue(page);
        if (!opened?.ok) throw new CommandExecutionError(opened?.message ?? 'Could not open scheduled posts queue');
        const result = await page.evaluate(buildScheduledDeleteScript(match));
        return [{
            status: result?.ok ? 'success' : 'failed',
            message: result?.message ?? 'Scheduled post delete failed.',
            match,
        }];
    }
});

export const __test__ = {
    buildScheduledDeleteScript,
    normalizeMatch,
};
