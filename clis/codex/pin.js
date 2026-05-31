import { cli, Strategy } from '@jackwener/opencli/registry';
import { conversationSelectionArgs, selectAndClickAction } from './_actions.js';

function defineToggle(name, labelOptions, doneStatus) {
    cli({
        site: 'codex',
        name,
        access: 'write',
        description: `${name === 'pin' ? 'Pin' : 'Unpin'} the selected Codex conversation via the Chat actions header menu.`,
        domain: 'localhost',
        strategy: Strategy.UI,
        browser: true,
        args: [...conversationSelectionArgs],
        columns: ['status'],
        func: async (page, kwargs) => {
            await selectAndClickAction(page, kwargs, labelOptions);
            await page.wait(0.6);
            return [{ status: doneStatus }];
        },
    });
}

// The Chat actions menu only shows the CURRENT state's label (Pin chat OR
// Unpin chat, never both). Each command binds to its matching label.
defineToggle('pin', ['Pin chat'], 'pinned');
defineToggle('unpin', ['Unpin chat'], 'unpinned');
