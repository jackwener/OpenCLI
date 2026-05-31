import { cli, Strategy } from '@jackwener/opencli/registry';
import { conversationSelectionArgs, selectAndClickAction } from './_actions.js';
import { openCodexConversation } from './sidebar.js';

cli({
    site: 'codex',
    name: 'archive',
    access: 'write',
    description: 'Archive (Codex\'s term for delete) the selected conversation via the Chat actions header menu. No confirmation in UI — pass --yes to actually archive.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'yes', type: 'boolean', default: false, help: 'Actually archive (default: dry-run preview)' },
        ...conversationSelectionArgs,
    ],
    columns: ['status'],
    func: async (page, kwargs) => {
        const yes = kwargs.yes === true || kwargs.yes === 'true' || kwargs.yes === '1';
        if (!yes) {
            // Resolve target so the dry-run still names what WOULD be archived.
            const selected = await openCodexConversation(page, kwargs);
            return [{
                status: `dry-run — would archive ${selected?.project || ''}/${selected?.conversation || '(active)'} — pass --yes to actually archive`,
            }];
        }
        await selectAndClickAction(page, kwargs, ['Archive chat']);
        await page.wait(1);
        return [{ status: 'archived' }];
    },
});
