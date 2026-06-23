import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { clickConversationMenuItem, conversationTargetArgs, getConversationMenuLabels } from './_actions.js';

cli({
    site: 'antigravity',
    name: 'mark-read',
    access: 'write',
    description: 'Mark an unread Antigravity conversation as read. Fails if the row is already read or the postcondition cannot be verified.',
    domain: '127.0.0.1',
    strategy: Strategy.UI,
    browser: true,
    args: [...conversationTargetArgs],
    columns: ['status', 'id', 'clicked'],
    func: async (page, kwargs) => {
        const id = String(kwargs.id);
        const before = await getConversationMenuLabels(page, id);
        if (!before.ok) {
            throw new CommandExecutionError(
                `${before.reason}${before.detail ? ' ' + before.detail : ''}`,
                'Make sure Antigravity is in the foreground and the sidebar is open.',
            );
        }
        if (!before.labels?.includes('Mark as Read')) {
            throw new CommandExecutionError(
                `Conversation ${id} is not currently markable as read.`,
                `Visible menu labels: ${JSON.stringify(before.labels || [])}`,
            );
        }

        const res = await clickConversationMenuItem(page, id, ['Mark as Read']);
        if (!res.ok) {
            throw new CommandExecutionError(
                `${res.reason}${res.detail ? ' ' + res.detail : ''}`,
                'Make sure Antigravity is in the foreground and the sidebar is open.',
            );
        }
        await page.wait(0.6);
        const after = await getConversationMenuLabels(page, id);
        if (!after.ok || !after.labels?.includes('Mark as Unread')) {
            throw new CommandExecutionError(
                `Could not verify conversation ${id} was marked read.`,
                `Visible menu labels after click: ${JSON.stringify(after.labels || [])}`,
            );
        }
        return [{
            status: 'marked-read',
            id,
            clicked: res.clicked,
        }];
    },
});
