import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { clickConversationMenuItem, conversationTargetArgs } from './_actions.js';

cli({
    site: 'antigravity',
    name: 'mark-read',
    access: 'write',
    description: 'Toggle read state on an Antigravity conversation (the 3-dot menu shows "Mark as Read" OR "Mark as Unread" depending on current state — this command clicks whichever is present).',
    domain: '127.0.0.1',
    strategy: Strategy.UI,
    browser: true,
    args: [...conversationTargetArgs],
    columns: ['status', 'id', 'clicked'],
    func: async (page, kwargs) => {
        const id = String(kwargs.id);
        // Antigravity shows "Mark as Read" when conversation is unread,
        // "Mark as Unread" when read. We don't try to be smart — we click
        // whichever is present and report what we actually did.
        const res = await clickConversationMenuItem(page, id, ['Mark as Read', 'Mark as Unread']);
        if (!res.ok) {
            throw new CommandExecutionError(
                `${res.reason}${res.detail ? ' ' + res.detail : ''}`,
                'Make sure Antigravity is in the foreground and the sidebar is open.',
            );
        }
        await page.wait(0.6);
        return [{
            status: res.clicked === 'Mark as Unread' ? 'marked-unread' : 'marked-read',
            id,
            clicked: res.clicked,
        }];
    },
});
