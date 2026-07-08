import { cli, Strategy } from '@jackwener/opencli/registry';
import { conversationSelectionArgs, setConversationPinned } from './_actions.js';

function defineToggle(name, desiredPinned) {
    cli({
        site: 'codex',
        name,
        access: 'write',
        description: `${name === 'pin' ? 'Pin' : 'Unpin'} the selected Codex conversation via the Chat actions header menu.`,
        domain: 'localhost',
        strategy: Strategy.UI,
        browser: true,
        args: [...conversationSelectionArgs],
        columns: ['status', 'thread_id', 'project', 'conversation'],
        func: async (page, kwargs) => {
            const result = await setConversationPinned(page, kwargs, desiredPinned);
            return [{
                status: result.status,
                thread_id: result.selected.threadId,
                project: result.selected.project,
                conversation: result.selected.conversation,
            }];
        },
    });
}

// The Chat actions menu only shows the CURRENT state's label (Pin chat OR
// Unpin chat, never both). Each command binds to its matching label.
defineToggle('pin', true);
defineToggle('unpin', false);
