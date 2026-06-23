import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import {
    clickConversationMenuItem,
    confirmDeleteDialog,
    conversationVisible,
    conversationTargetArgs,
} from './_actions.js';

cli({
    site: 'antigravity',
    name: 'delete',
    access: 'write',
    description: 'Delete an Antigravity conversation by ID. Antigravity asks for confirmation; we click through it. Require --yes to actually delete.',
    domain: '127.0.0.1',
    strategy: Strategy.UI,
    browser: true,
    args: [
        ...conversationTargetArgs,
        { name: 'yes', type: 'boolean', default: false, help: 'Actually delete (default: dry-run preview)' },
    ],
    columns: ['status', 'id'],
    func: async (page, kwargs) => {
        const id = String(kwargs.id);
        const yes = kwargs.yes === true || kwargs.yes === 'true' || kwargs.yes === '1';
        if (!yes) {
            return [{ status: 'dry-run (pass --yes to actually delete)', id }];
        }

        // 1. Open the per-row 3-dot menu and click "Delete Conversation".
        const menuRes = await clickConversationMenuItem(page, id, ['Delete Conversation', 'Delete']);
        if (!menuRes.ok) {
            throw new CommandExecutionError(
                `${menuRes.reason}${menuRes.detail ? ' ' + menuRes.detail : ''}`,
                'Make sure Antigravity is in the foreground and the sidebar is open.',
            );
        }

        // 2. Click the Delete button in the confirm dialog.
        const confirmRes = await confirmDeleteDialog(page, ['Delete', 'Delete Conversation', 'Confirm', 'OK']);
        if (!confirmRes.ok) {
            throw new CommandExecutionError(
                `${confirmRes.reason}${confirmRes.detail ? ' ' + confirmRes.detail : ''}`,
                'Delete menu fired but the confirm dialog did not show / its button was not found.',
            );
        }

        await page.wait(1);
        for (let attempt = 0; attempt < 10; attempt += 1) {
            if (!(await conversationVisible(page, id))) {
                return [{ status: 'deleted', id }];
            }
            await page.wait(0.5);
        }
        throw new CommandExecutionError(
            `Delete did not remove conversation ${id} from the visible sidebar.`,
            'The delete click/confirmation may have failed or the selector contract drifted.',
        );
    },
});
